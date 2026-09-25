import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { HandlePaymentWebhookCommand } from '../handle-payment-webhook.command';
import { PaymentWebhookLog } from '../../entities/payment-webhook-log.entity';
import { PAYMENT_PROVIDER, PaymentProvider } from '../../providers/payment-provider.interface';

@CommandHandler(HandlePaymentWebhookCommand)
export class HandlePaymentWebhookHandler implements ICommandHandler<HandlePaymentWebhookCommand> {
	constructor(
		@InjectRepository(PaymentWebhookLog)
		private readonly webhookLogRepository: Repository<PaymentWebhookLog>,
		@Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
	) {}

	async execute(command: HandlePaymentWebhookCommand) {
		const { payload, signature } = command.dto;

		const verifyResult = this.paymentProvider.verifyWebhook(payload, signature);
		if (!verifyResult.valid) {
			throw new RpcException({ statusCode: 400, message: 'Invalid webhook signature' });
		}

		// Idempotent: cùng eventId gọi lại (retry từ provider) chỉ xử lý 1 lần — bảng có unique constraint trên eventId.
		const existing = await this.webhookLogRepository.findOne({ where: { eventId: verifyResult.eventId } });
		if (existing) {
			return { processed: false, alreadyProcessed: true };
		}

		await this.webhookLogRepository.save(
			this.webhookLogRepository.create({
				eventId: verifyResult.eventId,
				orderId: verifyResult.orderId,
			}),
		);

		return { processed: true, alreadyProcessed: false };
	}
}
