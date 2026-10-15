import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import {
	Order,
	OrderRefundStatus,
	OrderStatus,
} from '../entities/order.entity';
import { refundAmountOf } from '../pricing/money';
import { OrderCancelReason } from './order-cancel-reason.enum';
import {
	OrderOutboxMessage,
	OrderTransitionService,
} from './order-transition.service';

export interface CancelUnpaidOptions {
	/**
	 * true: gửi ReleaseInventory. false khi Inventory đã tự trả phần giữ (đơn bị thay thế trong RESERVE).
	 */
	releaseInventory: boolean;
}

export interface CancelPaidOptions {
	/** Gửi RestockInventory (idempotent, cùng key orderId với CommitInventory nên xử lý đúng thứ tự). */
	restock: boolean;
	/** Gửi CancelShipment khi vận đơn có thể đã được tạo. */
	cancelShipment?: boolean;
}

/**
 * Huỷ đơn chưa thanh toán: đổi state qua OrderTransitionService (kiểm version) và ghi outbox
 * trả kho, vô hiệu intent, báo OrderCancelled{paid:false} (để Promotion trả lượt voucher) trong cùng transaction.
 * Lệch version ném OrderVersionConflictError, caller quyết định bỏ qua hay trả 409.
 */
@Injectable()
export class OrderCancellationService {
	constructor(private readonly orderTransition: OrderTransitionService) {}

	cancelUnpaid(
		manager: EntityManager,
		order: Order,
		reason: OrderCancelReason,
		options: CancelUnpaidOptions,
	): Promise<Order> {
		const messages: OrderOutboxMessage[] = [];
		if (options.releaseInventory) {
			messages.push({
				topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
				type: MESSAGE_TYPE.RELEASE_INVENTORY,
				payload: {},
			});
		}
		// Idempotent ở Payment: chỉ intent PENDING mới bị huỷ, không có intent thì no-op.
		messages.push({
			topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
			type: MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
			payload: {},
		});
		messages.push({
			topic: KAFKA_TOPIC.ORDER_EVENTS,
			type: MESSAGE_TYPE.ORDER_CANCELLED,
			payload: {
				userId: order.userId,
				paid: false,
				cancelReason: reason,
				...(order.voucherCode ? { voucherCode: order.voucherCode } : {}),
			},
		});

		return this.orderTransition.transition(manager, {
			order,
			to: OrderStatus.CANCELLED,
			patch: { cancelReason: reason },
			messages,
		});
	}

	/**
	 * Huỷ đơn đã thanh toán: hoàn tiền (tổng đã thu trừ phí ship), tuỳ chọn nhập lại kho đã commit
	 * và huỷ vận đơn, báo OrderCancelled{paid:true} (Promotion không trả lượt voucher). Tiến độ hoàn tiền
	 * chỉ hiển thị qua refundStatus, không đổi status đơn.
	 */
	cancelPaid(
		manager: EntityManager,
		order: Order,
		reason: OrderCancelReason,
		options: CancelPaidOptions,
	): Promise<Order> {
		const messages: OrderOutboxMessage[] = [
			{
				topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
				type: MESSAGE_TYPE.REFUND_PAYMENT,
				payload: { amount: refundAmountOf(order), reason },
			},
		];
		if (options.restock) {
			messages.push({
				topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
				type: MESSAGE_TYPE.RESTOCK_INVENTORY,
				payload: {},
			});
		}
		if (options.cancelShipment) {
			messages.push({
				topic: KAFKA_TOPIC.SHIPPING_COMMANDS,
				type: MESSAGE_TYPE.CANCEL_SHIPMENT,
				payload: {},
			});
		}
		messages.push({
			topic: KAFKA_TOPIC.ORDER_EVENTS,
			type: MESSAGE_TYPE.ORDER_CANCELLED,
			payload: {
				userId: order.userId,
				paid: true,
				cancelReason: reason,
				...(order.voucherCode ? { voucherCode: order.voucherCode } : {}),
			},
		});

		return this.orderTransition.transition(manager, {
			order,
			to: OrderStatus.CANCELLED,
			patch: { cancelReason: reason, refundStatus: OrderRefundStatus.PENDING },
			messages,
		});
	}
}
