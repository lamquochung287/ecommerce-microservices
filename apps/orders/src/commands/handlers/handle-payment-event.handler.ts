import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
	HandleResult,
	KafkaConsumerRunner,
	MessageEnvelope,
	OutboxWriter,
} from '@lib/messaging';
import type {
	OrderPaidPayload,
	PaymentRefundedPayload,
	PaymentRefundFailedPayload,
	PaymentSucceededPayload,
	RefundPaymentPayload,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import { EntityManager } from 'typeorm';
import { CartService } from '../../cart/cart.service';
import {
	Order,
	OrderRefundStatus,
	OrderStatus,
} from '../../entities/order.entity';
import { OrderCancelReason } from '../../order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { HandlePaymentEventCommand } from '../handle-payment-event.command';

const LATE_PAYMENT_REFUND_REASON = 'LATE_PAYMENT';

/**
 * Xử lý event trên `payment-events` trong transaction của runner (inbox + đổi state + outbox cùng một TX).
 * Quyết định theo trạng thái HIỆN TẠI của đơn, đọc lại mỗi lần chạy: lệch version làm transition ném lỗi,
 * runner retry và lần sau đọc lại đơn (vd scheduler vừa huỷ) để chọn nhánh khác. Message không khớp trạng thái
 * nào (trùng, đến muộn) là no-op, inbox vẫn được đánh dấu.
 */
@CommandHandler(HandlePaymentEventCommand)
export class HandlePaymentEventHandler implements ICommandHandler<HandlePaymentEventCommand> {
	private readonly logger = new Logger(HandlePaymentEventHandler.name);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly orderTransition: OrderTransitionService,
		private readonly cancellation: OrderCancellationService,
		private readonly outbox: OutboxWriter,
		private readonly cart: CartService,
	) {}

	execute(command: HandlePaymentEventCommand): Promise<void> {
		return this.runner.run({
			consumer: CONSUMER_GROUP.ORDERS,
			topic: command.topic,
			message: command.message,
			handle: (manager, envelope) => this.dispatch(manager, envelope),
		});
	}

	private async dispatch(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void | HandleResult> {
		switch (envelope.type) {
			case MESSAGE_TYPE.PAYMENT_SUCCEEDED:
				return this.onPaymentSucceeded(manager, envelope);
			case MESSAGE_TYPE.PAYMENT_FAILED:
				return this.onPaymentFailed(manager, envelope);
			case MESSAGE_TYPE.PAYMENT_REFUNDED:
				return this.onPaymentRefunded(manager, envelope);
			case MESSAGE_TYPE.PAYMENT_REFUND_FAILED:
				return this.onPaymentRefundFailed(manager, envelope);
			default:
				this.logger.warn(
					`Bỏ qua event lạ "${envelope.type}" (eventId=${envelope.eventId}) trên ${KAFKA_TOPIC.PAYMENT_EVENTS}`,
				);
		}
	}

	private async onPaymentSucceeded(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void | HandleResult> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;
		const payload = (envelope.payload ??
			{}) as Partial<PaymentSucceededPayload>;

		if (order.status === OrderStatus.PENDING_PAYMENT) {
			const paid: OrderPaidPayload = {
				userId: order.userId,
				...(order.voucherCode ? { voucherCode: order.voucherCode } : {}),
			};
			await this.orderTransition.transition(manager, {
				order,
				to: OrderStatus.PAID,
				patch: { paidAt: new Date() },
				messages: [
					{
						topic: KAFKA_TOPIC.ORDER_EVENTS,
						type: MESSAGE_TYPE.ORDER_PAID,
						payload: paid,
					},
					{
						topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
						type: MESSAGE_TYPE.COMMIT_INVENTORY,
						payload: {},
					},
				],
			});
			// Chỉ chạy khi transaction đã commit; lỗi Redis chỉ được log, không làm hỏng việc chuyển PAID.
			const items = order.items.map((item) => ({
				productId: item.productId,
				quantity: item.quantity,
			}));
			return {
				afterCommit: async () => {
					await this.cart.deductItems(order.userId, items);
				},
			};
		}

		if (
			order.status === OrderStatus.CANCELLED &&
			order.refundStatus === OrderRefundStatus.NONE
		) {
			await this.refundLatePayment(manager, order, payload.amount);
			return;
		}

		this.logger.debug(
			`PaymentSucceeded trùng/muộn cho đơn ${order.id} (${order.status}, refundStatus=${order.refundStatus}): bỏ qua`,
		);
	}

	/** Tiền đã thu cho đơn đã huỷ (chưa từng PAID): giữ CANCELLED, hoàn toàn bộ số đã thu, ghi cảnh báo đối soát. */
	private async refundLatePayment(
		manager: EntityManager,
		order: Order,
		amount: unknown,
	): Promise<void> {
		const refundAmount = Number(amount);
		if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
			// Ném để runner retry rồi đưa vào DLQ thay vì im lặng bỏ qua tiền đã thu.
			throw new Error(
				`PaymentSucceeded cho đơn ${order.id} có amount không hợp lệ: ${String(amount)}`,
			);
		}
		await this.orderTransition.updateWithVersion(manager, order, {
			refundStatus: OrderRefundStatus.PENDING,
		});
		const refund: RefundPaymentPayload = {
			amount: refundAmount,
			reason: LATE_PAYMENT_REFUND_REASON,
		};
		await this.outbox.append(manager, {
			topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
			type: MESSAGE_TYPE.REFUND_PAYMENT,
			orderId: order.id,
			payload: refund,
		});
		this.logger.warn(
			`Đối soát: thanh toán muộn cho đơn ${order.id} đã CANCELLED (${order.cancelReason ?? 'không rõ lý do'}), hoàn ${refundAmount}`,
		);
	}

	private async onPaymentFailed(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;
		if (order.status !== OrderStatus.PENDING_PAYMENT) {
			this.logger.debug(
				`PaymentFailed cho đơn ${order.id} đang ${order.status}: bỏ qua`,
			);
			return;
		}
		await this.cancellation.cancelUnpaid(
			manager,
			order,
			OrderCancelReason.PAYMENT_FAILED,
			{ releaseInventory: true },
		);
	}

	/**
	 * Kết quả hoàn tiền thành công. Số tiền ghi nhận lấy từ event (số Payment thực hoàn), không tính lại từ đơn
	 * vì luồng thanh toán muộn hoàn toàn bộ số đã thu. Idempotent theo trạng thái: đã ghi nhận thì no-op
	 * (Payment có thể phát lại với eventId khác).
	 */
	private async onPaymentRefunded(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;
		const payload = (envelope.payload ?? {}) as Partial<PaymentRefundedPayload>;

		if (order.status === OrderStatus.CANCELLED) {
			if (order.refundStatus === OrderRefundStatus.SUCCEEDED) {
				this.logger.debug(`PaymentRefunded trùng cho đơn ${order.id}: bỏ qua`);
				return;
			}
			await this.orderTransition.updateWithVersion(manager, order, {
				refundStatus: OrderRefundStatus.SUCCEEDED,
				refundedAmount: this.refundedAmountOf(order, payload.amount),
				refundedAt: new Date(),
			});
			return;
		}

		if (order.status === OrderStatus.REFUNDING) {
			await this.orderTransition.transition(manager, {
				order,
				to: OrderStatus.REFUNDED,
				patch: {
					refundedAmount: this.refundedAmountOf(order, payload.amount),
					refundedAt: new Date(),
				},
				// Kho chỉ nhập lại sau khi tiền đã hoàn; idempotent ở Inventory.
				messages: [
					{
						topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
						type: MESSAGE_TYPE.RESTOCK_INVENTORY,
						payload: {},
					},
				],
			});
			await manager.query(
				`UPDATE "refunds" SET "status" = 'COMPLETED', "updatedAt" = now() WHERE "order_id" = $1 AND "status" = 'PENDING'`,
				[order.id],
			);
			return;
		}

		this.logger.debug(
			`PaymentRefunded cho đơn ${order.id} đang ${order.status}: bỏ qua`,
		);
	}

	/**
	 * Hoàn tiền thất bại. Đơn đã huỷ: đánh dấu FAILED để admin xử lý tay. Đơn đang hoàn hàng: giữ REFUNDING
	 * (không có trạng thái lỗi riêng), chỉ báo lỗi để xử lý tay. Không ghi đè refundStatus đã SUCCEEDED.
	 */
	private async onPaymentRefundFailed(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;
		const payload = (envelope.payload ??
			{}) as Partial<PaymentRefundFailedPayload>;
		const reason = payload.reason ?? 'không rõ lý do';

		if (order.status === OrderStatus.CANCELLED) {
			if (
				order.refundStatus === OrderRefundStatus.FAILED ||
				order.refundStatus === OrderRefundStatus.SUCCEEDED
			) {
				this.logger.debug(
					`PaymentRefundFailed cho đơn ${order.id} (refundStatus=${order.refundStatus}): bỏ qua`,
				);
				return;
			}
			await this.orderTransition.updateWithVersion(manager, order, {
				refundStatus: OrderRefundStatus.FAILED,
			});
			this.logger.error(
				`Hoàn tiền thất bại cho đơn đã huỷ ${order.id}: ${reason}. Cần xử lý tay`,
			);
			return;
		}

		if (order.status === OrderStatus.REFUNDING) {
			this.logger.error(
				`Hoàn tiền thất bại cho đơn đang hoàn hàng ${order.id}: ${reason}. Đơn giữ REFUNDING, cần xử lý tay`,
			);
			return;
		}

		this.logger.debug(
			`PaymentRefundFailed cho đơn ${order.id} đang ${order.status}: bỏ qua`,
		);
	}

	/** amount không hợp lệ thì ném để runner retry rồi DLQ, không ghi số tiền hoàn sai. */
	private refundedAmountOf(order: Order, amount: unknown): number {
		const value = Number(amount);
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(
				`PaymentRefunded cho đơn ${order.id} có amount không hợp lệ: ${String(amount)}`,
			);
		}
		return value;
	}

	private async findOrder(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<Order | null> {
		const order = await manager.findOne(Order, {
			where: { id: envelope.orderId },
		});
		if (!order) {
			// Không retry: đơn không tồn tại thì lần sau cũng vậy. Inbox vẫn đánh dấu đã xử lý.
			this.logger.error(
				`${envelope.type} (eventId=${envelope.eventId}) cho đơn không tồn tại ${envelope.orderId}`,
			);
		}
		return order;
	}
}
