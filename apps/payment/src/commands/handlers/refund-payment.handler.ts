import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { RefundPaymentCommand } from '../refund-payment.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';
import {
	PaymentRefund,
	PaymentRefundStatus,
} from '../../entities/payment-refund.entity';
import {
	PAYMENT_PROVIDER,
	PaymentProvider,
	RefundResult,
} from '../../providers/payment-provider.interface';

const MONEY_EPSILON = 0.005;

// Hoàn cả đơn đúng một lần (unique orderId), số tiền do Orders chỉ định tường minh (đã trừ phí ship).
// Mọi kết quả (kể cả thất bại) được lưu rồi phát ra outbox cùng transaction với message đang xử lý; lần gọi
// lặp lại không gọi provider mà phát lại kết quả đã lưu.
@CommandHandler(RefundPaymentCommand)
export class RefundPaymentHandler implements ICommandHandler<RefundPaymentCommand> {
	private readonly logger = new Logger(RefundPaymentHandler.name);

	constructor(
		@Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
		private readonly outbox: OutboxWriter,
	) {}

	async execute(command: RefundPaymentCommand): Promise<{ refundId: string }> {
		const { manager, orderId, amount, reason } = command;
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new RpcException({
				statusCode: 400,
				message: 'Refund amount must be a positive number',
			});
		}

		const existing = await manager.findOne(PaymentRefund, {
			where: { orderId },
		});
		if (existing) {
			this.logger.warn(
				`Refund for order ${orderId} already recorded, replaying`,
			);
			await this.publish(manager, existing);
			return { refundId: existing.id };
		}

		const transaction = await manager.findOne(PaymentTransaction, {
			where: { orderId, status: PaymentTransactionStatus.SUCCEEDED },
			order: { createdAt: 'DESC' },
		});

		let outcome: RefundResult;
		if (!transaction) {
			outcome = {
				success: false,
				failureReason: 'No successful payment found',
			};
		} else if (amount - Number(transaction.amount) > MONEY_EPSILON) {
			outcome = {
				success: false,
				failureReason: 'Refund amount exceeds the amount collected',
			};
		} else {
			outcome = await this.callProvider(
				orderId,
				transaction.id,
				amount,
				reason,
			);
		}

		const refund: Partial<PaymentRefund> = {
			id: randomUUID(),
			orderId,
			transactionId: transaction?.id ?? null,
			amount,
			status: outcome.success
				? PaymentRefundStatus.SUCCEEDED
				: PaymentRefundStatus.FAILED,
			reason: reason.slice(0, 255),
			failureReason: outcome.success
				? null
				: (outcome.failureReason ?? 'Refund failed').slice(0, 255),
		};
		await manager.insert(PaymentRefund, refund);
		await this.publish(manager, refund as PaymentRefund);
		return { refundId: refund.id as string };
	}

	private async callProvider(
		orderId: string,
		transactionId: string,
		amount: number,
		reason: string,
	): Promise<RefundResult> {
		try {
			return await this.paymentProvider.refund({
				orderId,
				transactionId,
				amount,
				reason,
			});
		} catch (err) {
			return {
				success: false,
				failureReason: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private async publish(
		manager: EntityManager,
		refund: PaymentRefund,
	): Promise<void> {
		if (refund.status === PaymentRefundStatus.SUCCEEDED) {
			await this.outbox.append(manager, {
				topic: KAFKA_TOPIC.PAYMENT_EVENTS,
				type: MESSAGE_TYPE.PAYMENT_REFUNDED,
				orderId: refund.orderId,
				payload: { refundId: refund.id, amount: Number(refund.amount) },
			});
			return;
		}
		if (refund.status === PaymentRefundStatus.FAILED) {
			await this.outbox.append(manager, {
				topic: KAFKA_TOPIC.PAYMENT_EVENTS,
				type: MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
				orderId: refund.orderId,
				payload: { reason: refund.failureReason ?? 'Refund failed' },
			});
			return;
		}
		// Refund chỉ được ghi với trạng thái cuối; PENDING nghĩa là dữ liệu bất thường, để message retry.
		throw new Error(`Refund ${refund.id} is in a non-final state`);
	}
}
