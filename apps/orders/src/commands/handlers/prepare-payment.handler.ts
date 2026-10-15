import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { PaymentClient } from '../../clients/payment.client';
import { InventoryClient } from '../../clients/inventory.client';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderCancelReason } from '../../order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { PreparePaymentCommand } from '../prepare-payment.command';

export interface PaymentLinkResult {
	paymentUrl: string;
	expiresAt: string;
}

const OUT_OF_STOCK_MESSAGE = 'Hết hàng hoặc hết hạn giữ hàng';

/**
 * Chốt #2: lúc user bắt đầu thanh toán, chỉ trả link khi đơn còn chờ thanh toán, chưa quá hạn và hàng
 * vẫn đang được giữ. Không đạt thì huỷ đơn (trả kho, vô hiệu intent) và trả 409.
 */
@CommandHandler(PreparePaymentCommand)
export class PreparePaymentHandler implements ICommandHandler<PreparePaymentCommand> {
	constructor(
		private readonly dataSource: DataSource,
		private readonly inventory: InventoryClient,
		private readonly payment: PaymentClient,
		private readonly orderTransition: OrderTransitionService,
		private readonly cancellation: OrderCancellationService,
	) {}

	async execute(command: PreparePaymentCommand): Promise<PaymentLinkResult> {
		const { orderId, userId } = command;

		const order = await this.dataSource.manager.findOne(Order, {
			where: { id: orderId },
		});
		// Đơn của người khác trả 404 như không tồn tại để không lộ sự tồn tại của đơn.
		if (!order || order.userId !== userId) {
			throw new RpcException({ statusCode: 404, message: 'Order not found' });
		}
		if (order.status !== OrderStatus.PENDING_PAYMENT) {
			throw new RpcException({
				statusCode: 409,
				message: 'Đơn không còn chờ thanh toán',
			});
		}

		// Đơn chờ thanh toán không có hạn là dữ liệu không hợp lệ: coi như đã hết hạn.
		const expiresAt = new Date(order.expiresAt ?? 0);
		if (Date.now() >= expiresAt.getTime()) {
			await this.cancelAndReject(order, OrderCancelReason.PAYMENT_EXPIRED);
		}

		const check = await this.inventory.checkReservation(order.id);
		if (!check.valid) {
			await this.cancelAndReject(order, OrderCancelReason.RESERVATION_INVALID);
		}

		let checkoutUrl = order.paymentCheckoutUrl;
		if (!checkoutUrl) {
			// Idempotent theo orderId: gọi lặp (hoặc đua với checkout) trả lại cùng intent.
			const intent = await this.payment.createIntent({
				orderId: order.id,
				amount: Number(order.totalAmount),
				idempotencyKey: order.id,
				expiresAt: expiresAt.toISOString(),
			});
			await this.dataSource.transaction((manager) =>
				this.orderTransition.updateWithVersion(manager, order, {
					paymentIntentId: intent.intentId,
					paymentCheckoutUrl: intent.checkoutUrl,
				}),
			);
			checkoutUrl = intent.checkoutUrl;
		}

		return {
			paymentUrl: checkoutUrl,
			expiresAt: expiresAt.toISOString(),
		};
	}

	/** Huỷ đơn rồi từ chối request. Lệch version ném 409 "đơn vừa thay đổi" từ OrderTransitionService. */
	private async cancelAndReject(
		order: Order,
		reason: OrderCancelReason,
	): Promise<never> {
		await this.dataSource.transaction((manager) =>
			this.cancellation.cancelUnpaid(manager, order, reason, {
				releaseInventory: true,
			}),
		);
		throw new RpcException({ statusCode: 409, message: OUT_OF_STOCK_MESSAGE });
	}
}
