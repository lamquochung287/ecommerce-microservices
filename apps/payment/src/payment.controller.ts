import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PAYMENT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { ChargePaymentCommand } from './commands/charge-payment.command';
import { HandlePaymentWebhookCommand } from './commands/handle-payment-webhook.command';
import { GetTransactionQuery } from './queries/get-transaction.query';
import { ChargePaymentDto, PaymentWebhookDto } from './dto/charge-payment.dto';

@Controller()
export class PaymentController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: PAYMENT_MESSAGE_PATTERN.CHARGE_PAYMENT })
	async chargePayment(@Payload() dto: ChargePaymentDto) {
		return this.commandBus.execute(new ChargePaymentCommand(dto));
	}

	@MessagePattern({ cmd: PAYMENT_MESSAGE_PATTERN.HANDLE_WEBHOOK })
	async handleWebhook(@Payload() dto: PaymentWebhookDto) {
		return this.commandBus.execute(new HandlePaymentWebhookCommand(dto));
	}

	@MessagePattern({ cmd: PAYMENT_MESSAGE_PATTERN.GET_TRANSACTION })
	async getTransaction(@Payload() data: { orderId: string }) {
		return this.queryBus.execute(new GetTransactionQuery(data.orderId));
	}
}
