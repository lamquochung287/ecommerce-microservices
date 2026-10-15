import { Logger } from '@nestjs/common';
import { Kafka } from 'kafkajs';
import { KAFKA_TOPIC, dlqTopic } from 'libs/constant/kafka.constant';

const logger = new Logger('KafkaTopics');

export function allKafkaTopics(): string[] {
	const topics = Object.values(KAFKA_TOPIC) as string[];
	return [...topics, ...topics.map(dlqTopic)];
}

/**
 * Tạo mọi topic + DLQ của chúng. Auto-create bị tắt ở broker nên service phải gọi hàm này lúc khởi động.
 * Idempotent: chỉ tạo topic chưa tồn tại.
 */
export async function ensureKafkaTopics(
	brokers: string[],
	partitions: number,
): Promise<void> {
	const admin = new Kafka({
		clientId: 'topic-admin',
		brokers,
		retry: { retries: 5, initialRetryTime: 300 },
	}).admin();
	await admin.connect();
	try {
		// Chỉ tạo topic còn thiếu: createTopics với topic đã có sẽ ghi log lỗi ồn ào dù không throw.
		const existing = new Set(await admin.listTopics());
		const missing = allKafkaTopics().filter((t) => !existing.has(t));
		if (missing.length > 0) {
			await admin.createTopics({
				waitForLeaders: true,
				topics: missing.map((topic) => ({
					topic,
					numPartitions: partitions,
					replicationFactor: 1,
				})),
			});
		}
		logger.log(`Kafka topics ready (created ${missing.length})`);
	} finally {
		await admin.disconnect();
	}
}
