import {
	Injectable,
	Logger,
	OnApplicationShutdown,
	OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { kafkaBrokers } from './kafka-config';

const SEND_TIMEOUT_MS = 5000;

/**
 * Producer idempotent, acks=-1. `send` chỉ resolve sau khi broker ack toàn bộ ISR — điều kiện để
 * outbox được đánh dấu PUBLISHED. Kết nối lười: broker chưa sẵn sàng lúc khởi động không làm sập service.
 */
@Injectable()
export class KafkaProducerService
	implements OnModuleInit, OnApplicationShutdown
{
	private readonly logger = new Logger(KafkaProducerService.name);
	private readonly producer: Producer;
	private connecting: Promise<void> | null = null;
	private connected = false;

	constructor(config: ConfigService) {
		const kafka = new Kafka({
			clientId: 'ecommerce-producer',
			brokers: kafkaBrokers(config),
			connectionTimeout: 3000,
			retry: { retries: 3, initialRetryTime: 300 },
		});
		this.producer = kafka.producer({
			idempotent: true,
			maxInFlightRequests: 1,
		});
	}

	async onModuleInit(): Promise<void> {
		try {
			await this.ensureConnected();
		} catch (err) {
			this.logger.warn(
				`Kafka producer chưa kết nối được, sẽ thử lại khi gửi: ${(err as Error).message}`,
			);
		}
	}

	async onApplicationShutdown(): Promise<void> {
		if (!this.connected) return;
		this.connected = false;
		try {
			await this.producer.disconnect();
		} catch (err) {
			this.logger.warn(
				`Kafka producer disconnect lỗi: ${(err as Error).message}`,
			);
		}
	}

	async send(
		topic: string,
		key: string | null,
		value: unknown,
		headers: Record<string, string> = {},
	): Promise<void> {
		await this.ensureConnected();
		await this.producer.send({
			topic,
			acks: -1,
			timeout: SEND_TIMEOUT_MS,
			messages: [{ key, value: JSON.stringify(value), headers }],
		});
	}

	private ensureConnected(): Promise<void> {
		if (this.connected) return Promise.resolve();
		if (!this.connecting) {
			this.connecting = this.producer
				.connect()
				.then(() => {
					this.connected = true;
				})
				.finally(() => {
					this.connecting = null;
				});
		}
		return this.connecting;
	}
}
