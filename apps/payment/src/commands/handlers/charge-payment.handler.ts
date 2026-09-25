import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { ChargePaymentCommand } from '../charge-payment.command';
import { PaymentTransaction, PaymentTransactionStatus } from '../../entities/payment-transaction.entity';
import { PAYMENT_PROVIDER, PaymentProvider } from '../../providers/payment-provider.interface';
import { PAYMENT_EVENT_PATTERN } from 'libs/constant/message-pattern.constant';
import { ORDER_TCP_CLIENT } from '../../order-client.constant';

@CommandHandler(ChargePaymentCommand)
export class ChargePaymentHandler implements ICommandHandler<ChargePaymentCommand> {
	private readonly logger = new Logger(ChargePaymentHandler.name);

	constructor(
		@InjectRepository(PaymentTransaction)
		private readonly transactionRepository: Repository<PaymentTransaction>,
		@Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
		@Inject(ORDER_TCP_CLIENT) private readonly orderClient: ClientProxy,
	) {}

	async execute(command: ChargePaymentCommand) {
		const { orderId, amount, idempotencyKey } = command.dto;

		// Idempotent: cùng idempotencyKey (vd retry TCP timeout từ Orders) trả lại kết quả đã lưu, không charge lại.
		const existing = await this.transactionRepository.findOne({ where: { idempotencyKey } });
		if (existing) {
			this.logger.warn(`Duplicate charge request for idempotencyKey=${idempotencyKey}, returning stored result`);
			return this.toResult(existing);
		}

		const chargeResult = await this.paymentProvider.charge(orderId, amount);

		const transaction = await this.transactionRepository.save(
			this.transactionRepository.create({
				orderId,
				idempotencyKey,
				amount,
				status: chargeResult.success ? PaymentTransactionStatus.SUCCEEDED : PaymentTransactionStatus.FAILED,
				failureReason: chargeResult.failureReason ?? null,
			}),
		);

		this.orderClient.emit(
			chargeResult.success ? PAYMENT_EVENT_PATTERN.PAYMENT_SUCCEEDED : PAYMENT_EVENT_PATTERN.PAYMENT_FAILED,
			{ orderId, transactionId: transaction.id, amount, failureReason: chargeResult.failureReason },
		);

		return this.toResult(transaction);
	}

	private toResult(transaction: PaymentTransaction) {
		return {
			success: transaction.status === PaymentTransactionStatus.SUCCEEDED,
			transactionId: transaction.id,
			failureReason: transaction.failureReason ?? undefined,
		};
	}
}
