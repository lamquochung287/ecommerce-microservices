import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { SimulatePaymentCommand } from '../simulate-payment.command';
import { PaymentTransaction } from '../../entities/payment-transaction.entity';
import {
	PAYMENT_PROVIDER,
	PaymentProvider,
	PaymentSimulator,
	SimulatedWebhook,
} from '../../providers/payment-provider.interface';

@CommandHandler(SimulatePaymentCommand)
export class SimulatePaymentHandler implements ICommandHandler<SimulatePaymentCommand> {
	constructor(
		@InjectRepository(PaymentTransaction)
		private readonly transactionRepository: Repository<PaymentTransaction>,
		@Inject(PAYMENT_PROVIDER)
		private readonly paymentProvider: PaymentProvider & PaymentSimulator,
		private readonly configService: ConfigService,
	) {}

	// Chỉ dựng webhook đã ký; Gateway gửi lại vào /webhooks/payments để đi đúng đường verify thật.
	// Không chặn khi intent đã CANCELLED/hết hạn: cần mô phỏng thanh toán muộn.
	async execute(command: SimulatePaymentCommand): Promise<SimulatedWebhook> {
		if (this.configService.get<string>('NODE_ENV') === 'production') {
			throw new RpcException({ statusCode: 404, message: 'Not Found' });
		}
		const { intentId, result } = command.dto;
		const intent = await this.transactionRepository.findOne({
			where: { id: intentId },
		});
		if (!intent) {
			throw new RpcException({
				statusCode: 404,
				message: 'Payment intent not found',
			});
		}
		return this.paymentProvider.buildWebhook(
			{ id: intent.id, orderId: intent.orderId, amount: Number(intent.amount) },
			result,
		);
	}
}
