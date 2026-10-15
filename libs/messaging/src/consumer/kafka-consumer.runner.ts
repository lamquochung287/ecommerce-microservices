import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { dlqTopic } from 'libs/constant/kafka.constant';
import { DataSource, EntityManager } from 'typeorm';
import { MessageEnvelope, isValidEnvelope } from '../envelope';
import { InboxService } from '../inbox/inbox.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

export interface HandleResult {
	/** Chạy sau khi transaction commit; lỗi chỉ được log (vd trừ cart Redis). */
	afterCommit?: () => Promise<void>;
}

export interface ConsumerRunInput {
	/** Tên consumer group, làm khoá inbox. */
	consumer: string;
	topic: string;
	/** Giá trị đã parse JSON do Nest cung cấp (chưa tin cậy). */
	message: unknown;
	handle: (
		manager: EntityManager,
		envelope: MessageEnvelope,
	) => Promise<void | HandleResult>;
	/** Gọi một lần sau khi message đã vào DLQ (vd phát event thất bại). */
	onExhausted?: (envelope: MessageEnvelope, error: Error) => Promise<void>;
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bọc xử lý message Kafka: inbox + transaction + retry + DLQ.
 * Chỉ throw khi KHÔNG thể đảm bảo message đã được lưu ở đâu đó (gửi DLQ hoặc onExhausted lỗi), để kafkajs
 * không commit offset và message được giao lại thay vì bị mất.
 */
@Injectable()
export class KafkaConsumerRunner {
	private readonly logger = new Logger(KafkaConsumerRunner.name);
	private readonly maxAttempts: number;
	private readonly backoffMs: number;

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly inbox: InboxService,
		private readonly producer: KafkaProducerService,
		config: ConfigService,
	) {
		this.maxAttempts = config.get<number>('KAFKA_CONSUMER_MAX_ATTEMPTS', 3);
		this.backoffMs = config.get<number>('KAFKA_CONSUMER_RETRY_BACKOFF_MS', 200);
	}

	async run(input: ConsumerRunInput): Promise<void> {
		const { consumer, topic, message } = input;
		if (!isValidEnvelope(message)) {
			this.logger.error(
				`[${consumer}] envelope không hợp lệ trên ${topic}, đưa vào DLQ`,
			);
			await this.sendToDlq(topic, message, null, 'invalid envelope', 0);
			return;
		}

		let lastError: Error = new Error('unknown');
		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			try {
				await this.attempt(input, message);
				return;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				this.logger.warn(
					`[${consumer}] ${message.type} ${message.eventId} lỗi lần ${attempt}/${this.maxAttempts}: ${lastError.message}`,
				);
				if (attempt < this.maxAttempts) {
					await sleep(this.backoffMs * attempt);
				}
			}
		}

		this.logger.error(
			`[${consumer}] ${message.type} ${message.eventId} hết lượt retry, đưa vào DLQ`,
		);
		await this.sendToDlq(
			topic,
			message,
			message.orderId,
			lastError.message,
			this.maxAttempts,
		);
		if (input.onExhausted) {
			try {
				await input.onExhausted(message, lastError);
			} catch (err) {
				this.logger.error(
					`[${consumer}] onExhausted lỗi cho ${message.eventId}: ${(err as Error).message}`,
				);
				throw err;
			}
		}
	}

	private async attempt(
		input: ConsumerRunInput,
		envelope: MessageEnvelope,
	): Promise<void> {
		let result: void | HandleResult = undefined;
		await this.dataSource.transaction(async (manager) => {
			const acquired = await this.inbox.tryAcquire(
				manager,
				input.consumer,
				envelope.eventId,
			);
			if (!acquired) {
				this.logger.debug(
					`[${input.consumer}] bỏ qua message trùng ${envelope.eventId}`,
				);
				return;
			}
			result = await input.handle(manager, envelope);
		});
		const afterCommit = (result as HandleResult | undefined)?.afterCommit;
		if (afterCommit) {
			try {
				await afterCommit();
			} catch (err) {
				this.logger.error(
					`[${input.consumer}] afterCommit lỗi cho ${envelope.eventId}: ${(err as Error).message}`,
				);
			}
		}
	}

	private async sendToDlq(
		topic: string,
		value: unknown,
		key: string | null,
		error: string,
		attempts: number,
	): Promise<void> {
		await this.producer.send(dlqTopic(topic), key, value, {
			error: error.slice(0, 500),
			attempts: String(attempts),
		});
	}
}
