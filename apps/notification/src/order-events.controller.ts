import { Controller, Inject, Logger } from '@nestjs/common';
import {
	ClientProxy,
	EventPattern,
	Payload,
	Transport,
} from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { EntityManager } from 'typeorm';
import { CMD } from '@lib/common/constant/cmd';
import { KafkaConsumerRunner, MessageEnvelope } from '@lib/messaging';
import { CONSUMER_GROUP, KAFKA_TOPIC } from 'libs/constant/kafka.constant';
import {
	SentNotification,
	NotificationChannel,
	NotificationStatus,
} from './entities/sent-notification.entity';
import {
	EMAIL_PROVIDER,
	EmailProvider,
} from './providers/email-provider.interface';
import { buildOrderEventEmail } from './order-event-message';
import { USER_TCP_CLIENT } from './user-client.constant';

const TCP_TIMEOUT_MS = 10000;

// Consume order-events từ Kafka. Inbox + SentNotification ghi cùng transaction do KafkaConsumerRunner mở,
// nên cùng eventId được giao lại không tạo thêm email/dòng thông báo.
@Controller()
export class OrderEventsController {
	private readonly logger = new Logger(OrderEventsController.name);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		@Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
		@Inject(USER_TCP_CLIENT) private readonly userClient: ClientProxy,
	) {}

	@EventPattern(KAFKA_TOPIC.ORDER_EVENTS, Transport.KAFKA)
	async onOrderEvent(@Payload() message: unknown): Promise<void> {
		// Lookup email qua TCP nằm ngoài transaction để không giữ connection DB khi gọi mạng.
		let recipient: string | undefined;
		const userId = this.extractUserId(message);
		if (userId) {
			recipient = await this.resolveRecipient(userId);
		}

		await this.runner.run({
			consumer: CONSUMER_GROUP.NOTIFICATION,
			topic: KAFKA_TOPIC.ORDER_EVENTS,
			message,
			handle: (manager, envelope) => this.handle(manager, envelope, recipient),
		});
	}

	private async handle(
		manager: EntityManager,
		envelope: MessageEnvelope,
		recipient: string | undefined,
	): Promise<void> {
		const payload = (envelope.payload ?? {}) as Record<string, unknown>;
		const email = buildOrderEventEmail(
			envelope.type,
			envelope.orderId,
			payload,
		);
		// Loại event không gửi email: inbox vẫn được đánh dấu (runner đã acquire) để không xử lý lại.
		if (!email) return;

		const to = recipient ?? this.userIdOf(payload) ?? envelope.orderId;
		const result = await this.emailProvider.send(to, email.subject, email.body);

		await manager.save(
			manager.create(SentNotification, {
				channel: NotificationChannel.EMAIL,
				recipient: to,
				subject: email.subject,
				body: email.body,
				status: result.success
					? NotificationStatus.SENT
					: NotificationStatus.FAILED,
				sourceEvent: envelope.type,
			}),
		);
	}

	private userIdOf(payload: Record<string, unknown>): string | undefined {
		return typeof payload.userId === 'string' && payload.userId.length > 0
			? payload.userId
			: undefined;
	}

	/** Chỉ tra user cho loại event có gửi email; envelope sai hình dạng để runner đưa vào DLQ. */
	private extractUserId(message: unknown): string | undefined {
		if (typeof message !== 'object' || message === null) return undefined;
		const { type, orderId, payload } = message as Record<string, unknown>;
		if (typeof type !== 'string' || typeof orderId !== 'string') {
			return undefined;
		}
		if (!buildOrderEventEmail(type, orderId, {})) return undefined;
		if (typeof payload !== 'object' || payload === null) return undefined;
		return this.userIdOf(payload as Record<string, unknown>);
	}

	private async resolveRecipient(userId: string): Promise<string> {
		try {
			const user = await firstValueFrom(
				this.userClient
					.send<{ email?: string } | null>({ cmd: CMD.GET_USER_INFO }, userId)
					.pipe(timeout(TCP_TIMEOUT_MS)),
			);
			return user?.email ?? userId;
		} catch (error) {
			this.logger.warn(
				`Cannot resolve email for userId=${userId}, falling back to userId as recipient: ${error instanceof Error ? error.message : String(error)}`,
			);
			return userId;
		}
	}
}
