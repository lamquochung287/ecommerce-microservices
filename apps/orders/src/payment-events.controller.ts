import { Controller, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { EventPattern, Payload } from '@nestjs/microservices';
import { PAYMENT_EVENT_PATTERN } from 'libs/constant/message-pattern.constant';
import { ConfirmOrderPaymentCommand } from './commands/confirm-order-payment.command';

interface PaymentEventPayload {
	orderId?: string;
	transactionId?: string;
	failureReason?: string;
}

// Nhận event Payment emit qua TCP (point-to-point, at-most-once, không có retry).
@Controller()
export class PaymentEventsController {
	private readonly logger = new Logger(PaymentEventsController.name);

	constructor(private readonly commandBus: CommandBus) {}

	@EventPattern(PAYMENT_EVENT_PATTERN.PAYMENT_SUCCEEDED)
	async handlePaymentSucceeded(@Payload() payload: PaymentEventPayload) {
		if (!payload?.orderId) {
			this.logger.warn('payment_succeeded without orderId, ignored');
			return;
		}
		await this.commandBus.execute(
			new ConfirmOrderPaymentCommand(payload.orderId),
		);
	}

	// Thanh toán thất bại đã được Saga xử lý đồng bộ ngay khi nhận kết quả charge: hoàn kho và đặt đơn
	// CANCELLED, tức tồn kho và tiền đều về trạng thái ban đầu (xem CreateOrderHandler). Ở đây chỉ ghi log.
	@EventPattern(PAYMENT_EVENT_PATTERN.PAYMENT_FAILED)
	handlePaymentFailed(@Payload() payload: PaymentEventPayload) {
		this.logger.warn(
			`payment_failed for order ${payload?.orderId}: ${payload?.failureReason ?? 'unknown reason'} (Saga already released stock and cancelled the order)`,
		);
	}
}
