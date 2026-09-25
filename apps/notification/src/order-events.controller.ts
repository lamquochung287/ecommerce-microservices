import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload, ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom, timeout } from 'rxjs';
import { CMD } from '@lib/common/constant/cmd';
import { SentNotification, NotificationChannel, NotificationStatus } from './entities/sent-notification.entity';
import { EMAIL_PROVIDER, EmailProvider } from './providers/email-provider.interface';
import { USER_TCP_CLIENT } from './user-client.constant';

const TCP_TIMEOUT_MS = 10000;

// Lắng nghe event từ Orders qua TCP EventPattern. Orders emit trực tiếp tới TCP client của Notification
// (xem apps/orders/src/outbox/outbox.worker.ts) — TCP transport của NestJS là point-to-point, không broadcast.
@Controller()
export class OrderEventsController {
	private readonly logger = new Logger(OrderEventsController.name);

	constructor(
		@InjectRepository(SentNotification)
		private readonly sentNotificationRepository: Repository<SentNotification>,
		@Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
		@Inject(USER_TCP_CLIENT) private readonly userClient: ClientProxy,
	) {}

	@EventPattern('order.created')
	async onOrderCreated(@Payload() payload: { orderId: string; userId: string; totalAmount: number }) {
		await this.notifyUser(
			payload.userId,
			`Đơn hàng ${payload.orderId} đã được tạo`,
			`Đơn hàng của bạn (tổng tiền ${payload.totalAmount}) đã được xác nhận.`,
			'order.created',
		);
	}

	@EventPattern('order.status_updated')
	async onOrderStatusUpdated(
		@Payload() payload: { orderId: string; userId: string; previousStatus: string; status: string },
	) {
		await this.notifyUser(
			payload.userId,
			`Đơn hàng ${payload.orderId} đã cập nhật trạng thái`,
			`Trạng thái đơn hàng chuyển từ ${payload.previousStatus} sang ${payload.status}.`,
			'order.status_updated',
		);
	}

	private async notifyUser(userId: string, subject: string, body: string, sourceEvent: string) {
		let recipient = userId;
		try {
			const user = await firstValueFrom(
				this.userClient.send({ cmd: CMD.GET_USER_INFO }, userId).pipe(timeout(TCP_TIMEOUT_MS)),
			);
			recipient = (user as { email?: string })?.email ?? userId;
		} catch (error) {
			this.logger.warn(`Cannot resolve email for userId=${userId}, falling back to userId as recipient: ${error?.message ?? error}`);
		}

		const result = await this.emailProvider.send(recipient, subject, body);

		await this.sentNotificationRepository.save(
			this.sentNotificationRepository.create({
				channel: NotificationChannel.EMAIL,
				recipient,
				subject,
				body,
				status: result.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
				sourceEvent,
			}),
		);
	}
}
