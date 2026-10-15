import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { PAYMENT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { HandlePaymentWebhookCommand } from './commands/handle-payment-webhook.command';
import { CreatePaymentIntentCommand } from './commands/create-payment-intent.command';
import { SimulatePaymentCommand } from './commands/simulate-payment.command';
import { GetTransactionQuery } from './queries/get-transaction.query';
import { GetPaymentIntentQuery } from './queries/get-payment-intent.query';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import {
	CreatePaymentIntentDto,
	IntentIdDto,
	SimulatePaymentDto,
} from './dto/payment-intent.dto';

@Controller()
export class PaymentController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: PAYMENT_MESSAGE_PATTERN.CREATE_INTENT }, Transport.TCP)
	async createIntent(@Payload() dto: CreatePaymentIntentDto) {
		return this.commandBus.execute(new CreatePaymentIntentCommand(dto));
	}

	@MessagePattern(
		{ cmd: PAYMENT_MESSAGE_PATTERN.HANDLE_WEBHOOK },
		Transport.TCP,
	)
	async handleWebhook(@Payload() dto: PaymentWebhookDto) {
		return this.commandBus.execute(new HandlePaymentWebhookCommand(dto));
	}

	@MessagePattern({ cmd: PAYMENT_MESSAGE_PATTERN.GET_INTENT }, Transport.TCP)
	async getIntent(@Payload() dto: IntentIdDto) {
		return this.queryBus.execute(new GetPaymentIntentQuery(dto.intentId));
	}

	@MessagePattern(
		{ cmd: PAYMENT_MESSAGE_PATTERN.SIMULATE_PAYMENT },
		Transport.TCP,
	)
	async simulatePayment(@Payload() dto: SimulatePaymentDto) {
		return this.commandBus.execute(new SimulatePaymentCommand(dto));
	}

	@MessagePattern(
		{ cmd: PAYMENT_MESSAGE_PATTERN.GET_TRANSACTION },
		Transport.TCP,
	)
	async getTransaction(@Payload() data: { orderId: string }) {
		return this.queryBus.execute(new GetTransactionQuery(data.orderId));
	}
}
