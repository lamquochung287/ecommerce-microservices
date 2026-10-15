import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CreatePaymentIntentCommand } from '../create-payment-intent.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';
import {
	PAYMENT_PROVIDER,
	PaymentProvider,
} from '../../providers/payment-provider.interface';
import { PaymentAutoSimulatorService } from '../../simulator/payment-auto-simulator.service';

const PG_UNIQUE_VIOLATION = '23505';

export interface PaymentIntentResult {
	intentId: string;
	status: PaymentTransactionStatus;
	checkoutUrl: string | null;
	expiresAt: string | null;
}

@CommandHandler(CreatePaymentIntentCommand)
export class CreatePaymentIntentHandler implements ICommandHandler<CreatePaymentIntentCommand> {
	private readonly logger = new Logger(CreatePaymentIntentHandler.name);

	constructor(
		@InjectRepository(PaymentTransaction)
		private readonly transactionRepository: Repository<PaymentTransaction>,
		@Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
		private readonly autoSimulator: PaymentAutoSimulatorService,
	) {}

	async execute(
		command: CreatePaymentIntentCommand,
	): Promise<PaymentIntentResult> {
		const { orderId, amount, idempotencyKey, expiresAt } = command.dto;

		// Idempotent theo idempotencyKey (= orderId): trả lại intent cũ ở mọi trạng thái, kể cả CANCELLED/SUCCEEDED,
		// để retry của Orders không tạo intent thứ hai hay hồi sinh intent đã vô hiệu.
		const existing = await this.findByKey(idempotencyKey);
		if (existing) return this.toResult(existing);

		// Hạn của intent đúng bằng hạn giữ hàng Orders gửi sang, không bao giờ dài hơn.
		const intentExpiresAt = new Date(expiresAt);
		const intentId = randomUUID();
		const { checkoutUrl } = this.paymentProvider.createIntent({
			intentId,
			orderId,
			amount,
			expiresAt: intentExpiresAt,
		});

		let created: PaymentTransaction;
		try {
			created = await this.transactionRepository.save(
				this.transactionRepository.create({
					id: intentId,
					orderId,
					idempotencyKey,
					amount,
					status: PaymentTransactionStatus.PENDING,
					failureReason: null,
					expiresAt: intentExpiresAt,
					checkoutUrl,
					paidAt: null,
				}),
			);
		} catch (err) {
			// Hai request cùng key đua nhau: bên thua đọc lại intent của bên thắng.
			if (this.isUniqueViolation(err)) {
				const winner = await this.findByKey(idempotencyKey);
				if (winner) return this.toResult(winner);
			}
			throw err;
		}

		this.logger.log(
			`Created payment intent ${created.id} for order ${orderId}`,
		);
		this.autoSimulator.schedule(created);
		return this.toResult(created);
	}

	private findByKey(idempotencyKey: string) {
		return this.transactionRepository.findOne({ where: { idempotencyKey } });
	}

	private isUniqueViolation(err: unknown): boolean {
		return (
			err instanceof QueryFailedError &&
			(err.driverError as { code?: string } | undefined)?.code ===
				PG_UNIQUE_VIOLATION
		);
	}

	private toResult(intent: PaymentTransaction): PaymentIntentResult {
		return {
			intentId: intent.id,
			status: intent.status,
			checkoutUrl: intent.checkoutUrl,
			expiresAt: intent.expiresAt
				? new Date(intent.expiresAt).toISOString()
				: null,
		};
	}
}
