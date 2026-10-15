import {
	Inject,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { metrics } from '@opentelemetry/api';
import { DataSource, EntityManager } from 'typeorm';
import { ENVELOPE_VERSION, MessageEnvelope } from '../envelope';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import {
	MESSAGING_OPTIONS,
	MessagingModuleOptions,
	OUTBOX_RELAY_BATCH_SIZE,
} from '../messaging.constant';

interface OutboxRow {
	id: string;
	eventId: string;
	topic: string;
	key: string | null;
	eventType: string;
	payload: unknown;
	retryCount: number;
	createdAt: Date;
}

const MAX_BACKOFF_MS = 60_000;

/**
 * Chọn row PENDING đến hạn. `NOT EXISTS` chặn row đứng sau khi cùng key còn row PENDING có seq nhỏ hơn
 * (kể cả row đó đang bị instance khác khoá hoặc đang chờ backoff) nên thứ tự theo orderId luôn được giữ.
 */
const SELECT_DUE_SQL = `
	SELECT o."id", o."eventId", o."topic", o."key", o."eventType", o."payload", o."retryCount", o."createdAt"
	FROM outbox o
	WHERE o."status" = 'PENDING' AND o."source" = $1 AND o."nextAttemptAt" <= now()
	  AND NOT EXISTS (
		SELECT 1 FROM outbox p
		WHERE p."key" = o."key" AND p."status" = 'PENDING' AND p."seq" < o."seq"
	  )
	ORDER BY o."seq"
	LIMIT $2
	FOR UPDATE OF o SKIP LOCKED`;

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(OutboxRelayService.name);
	private readonly failedCounter = metrics
		.getMeter('messaging')
		.createCounter('outbox_failed_total', {
			description: 'Outbox rows moved to FAILED after exhausting retries',
		});
	private timer: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly intervalMs: number;
	private readonly maxRetry: number;

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly producer: KafkaProducerService,
		config: ConfigService,
		@Inject(MESSAGING_OPTIONS) private readonly options: MessagingModuleOptions,
	) {
		this.intervalMs = config.get<number>('OUTBOX_RELAY_INTERVAL_MS', 1000);
		this.maxRetry = config.get<number>('OUTBOX_MAX_RETRY', 10);
	}

	onModuleInit(): void {
		this.timer = setInterval(() => void this.processBatch(), this.intervalMs);
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * Một tick = một transaction: khoá batch, gửi tuần tự, đánh dấu PUBLISHED chỉ sau khi broker ack.
	 * Lỗi đầu tiên dừng batch để row sau không vượt row trước. Không bao giờ throw (chạy từ timer).
	 */
	async processBatch(): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;
		try {
			await this.dataSource.transaction(async (manager) => {
				const rows: OutboxRow[] = await manager.query(SELECT_DUE_SQL, [
					this.options.source,
					OUTBOX_RELAY_BATCH_SIZE,
				]);
				for (const row of rows) {
					const published = await this.publishRow(manager, row);
					if (!published) break;
				}
			});
		} catch (err) {
			this.logger.error(`Outbox relay tick lỗi: ${(err as Error).message}`);
		} finally {
			this.isRunning = false;
		}
	}

	private async publishRow(
		manager: EntityManager,
		row: OutboxRow,
	): Promise<boolean> {
		const envelope: MessageEnvelope = {
			eventId: row.eventId,
			type: row.eventType,
			orderId: row.key ?? '',
			occurredAt: new Date(row.createdAt).toISOString(),
			version: ENVELOPE_VERSION,
			payload: row.payload,
		};
		try {
			await this.producer.send(row.topic, row.key, envelope, {
				type: row.eventType,
			});
		} catch (err) {
			await this.recordFailure(manager, row, err as Error);
			return false;
		}
		await manager.query(
			`UPDATE outbox SET "status" = 'PUBLISHED', "publishedAt" = now() WHERE "id" = $1`,
			[row.id],
		);
		return true;
	}

	private async recordFailure(
		manager: EntityManager,
		row: OutboxRow,
		err: Error,
	): Promise<void> {
		const retryCount = row.retryCount + 1;
		const message = err.message.slice(0, 1000);
		if (retryCount >= this.maxRetry) {
			await manager.query(
				`UPDATE outbox SET "status" = 'FAILED', "retryCount" = $2, "lastError" = $3 WHERE "id" = $1`,
				[row.id, retryCount, message],
			);
			this.failedCounter.add(1, { source: this.options.source });
			this.logger.error(
				`Outbox ${row.eventId} (${row.eventType}) FAILED sau ${retryCount} lần: ${message}`,
			);
			return;
		}
		const delayMs = Math.min(2 ** retryCount * 1000, MAX_BACKOFF_MS);
		await manager.query(
			`UPDATE outbox SET "retryCount" = $2, "lastError" = $3,
			 "nextAttemptAt" = now() + make_interval(secs => $4::double precision / 1000)
			 WHERE "id" = $1`,
			[row.id, retryCount, message, delayMs],
		);
		this.logger.warn(
			`Outbox ${row.eventId} gửi lỗi (lần ${retryCount}), thử lại sau ${delayMs}ms: ${message}`,
		);
	}
}
