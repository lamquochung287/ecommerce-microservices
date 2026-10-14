import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfirmOrderPaymentCommand } from '../confirm-order-payment.command';
import { UpdateOrderStatusCommand } from '../update-order-status.command';
import { Order, OrderStatus } from '../../entities/order.entity';

// Payment emit `payment_succeeded` trước khi trả kết quả đồng bộ cho Saga, nên event có thể tới khi
// đơn vẫn còn PENDING (Saga chưa kịp chuyển PROCESSING). Chờ ngắn rồi kiểm tra lại thay vì bỏ sót.
const PENDING_RETRY_ATTEMPTS = 10;
const PENDING_RETRY_DELAY_MS = 300;

// Chuyển đơn PROCESSING -> PAID khi Payment báo thanh toán thành công. Không bao giờ throw: event
// là fire-and-forget, throw chỉ sinh log lỗi mà không ai xử lý.
@CommandHandler(ConfirmOrderPaymentCommand)
export class ConfirmOrderPaymentHandler implements ICommandHandler<ConfirmOrderPaymentCommand> {
	private readonly logger = new Logger(ConfirmOrderPaymentHandler.name);

	constructor(
		@InjectRepository(Order)
		private readonly orderRepository: Repository<Order>,
		private readonly commandBus: CommandBus,
	) {}

	async execute(command: ConfirmOrderPaymentCommand): Promise<void> {
		const { orderId } = command;

		for (let attempt = 1; attempt <= PENDING_RETRY_ATTEMPTS; attempt++) {
			const order = await this.orderRepository.findOne({
				where: { id: orderId },
			});
			if (!order) {
				this.logger.warn(`payment_succeeded for unknown order ${orderId}`);
				return;
			}

			switch (order.status) {
				case OrderStatus.PENDING:
					if (attempt === PENDING_RETRY_ATTEMPTS) {
						this.logger.warn(
							`Order ${orderId} still PENDING after payment_succeeded, leaving PROCESSING->PAID to manual update`,
						);
						return;
					}
					await this.sleep(PENDING_RETRY_DELAY_MS);
					continue;

				case OrderStatus.PROCESSING:
					await this.markPaid(orderId);
					return;

				case OrderStatus.CANCELLED:
					// Tiền đã thu nhưng đơn đã hủy: cần hoàn tiền thủ công, không tự xử lý ở đây.
					this.logger.warn(
						`payment_succeeded for CANCELLED order ${orderId}: payment captured on a cancelled order, needs manual refund`,
					);
					return;

				default:
					// PAID trở đi: event lặp lại, bỏ qua.
					return;
			}
		}
	}

	private async markPaid(orderId: string): Promise<void> {
		try {
			await this.commandBus.execute(
				new UpdateOrderStatusCommand(orderId, { status: OrderStatus.PAID }),
			);
			this.logger.log(`Order ${orderId} marked PAID`);
		} catch (error) {
			this.logger.warn(
				`Could not mark order ${orderId} PAID: ${error?.message ?? JSON.stringify(error)}`,
			);
		}
	}

	protected sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
