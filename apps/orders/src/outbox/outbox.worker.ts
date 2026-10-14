import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { Outbox, OutboxStatus } from '../entities/outbox.entity';
import { NOTIFICATION_TCP_CLIENT } from './outbox.constant';

const MAX_RETRY = 5;
const BATCH_SIZE = 20;

@Injectable()
export class OutboxWorker {
	private readonly logger = new Logger(OutboxWorker.name);
	private isRunning = false;
	private readonly subscribers: ClientProxy[];

	constructor(
		@InjectRepository(Outbox)
		private readonly outboxRepository: Repository<Outbox>,
		@Inject(NOTIFICATION_TCP_CLIENT)
		private readonly notificationClient: ClientProxy,
	) {
		// TCP transport của NestJS là point-to-point (không broadcast) — mỗi subscriber cần emit riêng.
		// Thêm subscriber mới (vd Review khi cần biết OrderDelivered) thì bổ sung ClientProxy vào đây.
		this.subscribers = [this.notificationClient];
	}

	@Cron(CronExpression.EVERY_SECOND)
	async processPendingEvents() {
		// Tránh 2 lần chạy chồng nhau nếu 1 batch xử lý lâu hơn 1s
		if (this.isRunning) {
			return;
		}
		this.isRunning = true;

		try {
			const pendingEvents = await this.outboxRepository.find({
				where: { status: OutboxStatus.PENDING },
				order: { createdAt: 'ASC' },
				take: BATCH_SIZE,
			});

			for (const event of pendingEvents) {
				await this.publishEvent(event);
			}
		} catch (err) {
			this.logger.error(`Outbox polling failed: ${err.message}`);
		} finally {
			this.isRunning = false;
		}
	}

	private async publishEvent(event: Outbox) {
		try {
			for (const subscriber of this.subscribers) {
				subscriber.emit(event.eventType, event.payload);
			}

			event.status = OutboxStatus.PUBLISHED;
			event.publishedAt = new Date();
			await this.outboxRepository.save(event);
			this.logger.log(
				`Published outbox event ${event.id} (${event.eventType})`,
			);
		} catch (err) {
			event.retryCount += 1;
			if (event.retryCount >= MAX_RETRY) {
				event.status = OutboxStatus.FAILED;
				this.logger.error(
					`Outbox event ${event.id} failed permanently after ${MAX_RETRY} retries: ${err.message}`,
				);
			} else {
				this.logger.warn(
					`Outbox event ${event.id} publish failed (retry ${event.retryCount}/${MAX_RETRY}): ${err.message}`,
				);
			}
			await this.outboxRepository.save(event);
		}
	}
}
