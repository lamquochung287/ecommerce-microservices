import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { HandlePaymentWebhookCommand } from '../handle-payment-webhook.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';
import {
	PAYMENT_PROVIDER,
	PaymentProvider,
} from '../../providers/payment-provider.interface';

interface ParsedWebhook {
	eventId: string;
	intentId: string;
	orderId: string;
	status: 'SUCCEEDED' | 'FAILED';
	amount: number | null;
	reason: string | null;
}

const badRequest = (message: string) =>
	new RpcException({ statusCode: 400, message });

@CommandHandler(HandlePaymentWebhookCommand)
export class HandlePaymentWebhookHandler implements ICommandHandler<HandlePaymentWebhookCommand> {
	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		@Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
		private readonly outbox: OutboxWriter,
	) {}

	async execute(command: HandlePaymentWebhookCommand) {
		const { payload, signature } = command.dto;

		// Chữ ký sai thì không đụng DB: không ghi log, không outbox.
		const verifyResult = this.paymentProvider.verifyWebhook(payload, signature);
		if (!verifyResult.valid) {
			throw badRequest('Invalid webhook signature');
		}
		const webhook = this.parse(payload);

		return this.dataSource.transaction(async (manager) => {
			// Idempotent theo eventId: dòng log cùng transaction với đổi state nên chỉ commit khi xử lý xong.
			const inserted: unknown[] = await manager.query(
				`INSERT INTO payment_webhook_logs ("eventId", "orderId") VALUES ($1, $2)
				 ON CONFLICT ("eventId") DO NOTHING RETURNING id`,
				[webhook.eventId, webhook.orderId],
			);
			if (inserted.length === 0) {
				return { processed: false, alreadyProcessed: true };
			}

			// Khoá dòng intent để webhook song song/CancelPaymentIntent không đua nhau.
			const intent = await manager.findOne(PaymentTransaction, {
				where: { id: webhook.intentId },
				lock: { mode: 'pessimistic_write' },
			});
			if (!intent) {
				throw new RpcException({
					statusCode: 404,
					message: 'Payment intent not found',
				});
			}
			if (intent.orderId !== webhook.orderId) {
				throw badRequest('Webhook orderId does not match the intent');
			}
			const amount = Number(intent.amount);
			if (webhook.amount !== null && webhook.amount !== amount) {
				throw badRequest('Webhook amount does not match the intent');
			}

			if (webhook.status === 'SUCCEEDED') {
				// CANCELLED vẫn nhận: tiền đã thu thật, Orders quyết định hoàn.
				if (
					intent.status === PaymentTransactionStatus.PENDING ||
					intent.status === PaymentTransactionStatus.CANCELLED
				) {
					await manager.update(PaymentTransaction, intent.id, {
						status: PaymentTransactionStatus.SUCCEEDED,
						paidAt: new Date(),
						failureReason: null,
					});
					await this.outbox.append(manager, {
						topic: KAFKA_TOPIC.PAYMENT_EVENTS,
						type: MESSAGE_TYPE.PAYMENT_SUCCEEDED,
						orderId: intent.orderId,
						payload: { intentId: intent.id, amount },
					});
				}
			} else if (intent.status === PaymentTransactionStatus.PENDING) {
				const reason = webhook.reason ?? 'Payment failed';
				await manager.update(PaymentTransaction, intent.id, {
					status: PaymentTransactionStatus.FAILED,
					failureReason: reason.slice(0, 255),
				});
				await this.outbox.append(manager, {
					topic: KAFKA_TOPIC.PAYMENT_EVENTS,
					type: MESSAGE_TYPE.PAYMENT_FAILED,
					orderId: intent.orderId,
					payload: { reason },
				});
			}
			// Mọi tổ hợp còn lại (intent đã SUCCEEDED/FAILED, FAILED tới intent CANCELLED) là no-op.

			return { processed: true, alreadyProcessed: false };
		});
	}

	// Payload đã qua HMAC nhưng vẫn kiểm hình dạng: secret đúng không bảo đảm người ký gửi đúng schema.
	private parse(payload: Record<string, unknown>): ParsedWebhook {
		const { eventId, intentId, orderId, status, amount, reason } = payload;
		if (typeof eventId !== 'string' || eventId.length === 0) {
			throw badRequest('Webhook eventId is required');
		}
		if (typeof intentId !== 'string' || !isUUID(intentId)) {
			throw badRequest('Webhook intentId must be a UUID');
		}
		if (typeof orderId !== 'string' || !isUUID(orderId)) {
			throw badRequest('Webhook orderId must be a UUID');
		}
		if (status !== 'SUCCEEDED' && status !== 'FAILED') {
			throw badRequest('Webhook status must be SUCCEEDED or FAILED');
		}
		return {
			eventId,
			intentId,
			orderId,
			status,
			amount: typeof amount === 'number' ? amount : null,
			reason: typeof reason === 'string' ? reason : null,
		};
	}
}
