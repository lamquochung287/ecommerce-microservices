import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NOTIFICATION_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { SentNotification } from './entities/sent-notification.entity';

@Controller()
export class NotificationController {
	constructor(
		@InjectRepository(SentNotification)
		private readonly sentNotificationRepository: Repository<SentNotification>,
	) {}

	@MessagePattern(
		{ cmd: NOTIFICATION_MESSAGE_PATTERN.GET_SENT_NOTIFICATIONS },
		Transport.TCP,
	)
	async getSentNotifications(@Payload() data?: { recipient?: string }) {
		const where = data?.recipient ? { recipient: data.recipient } : {};
		return this.sentNotificationRepository.find({
			where,
			order: { createdAt: 'DESC' },
		});
	}
}
