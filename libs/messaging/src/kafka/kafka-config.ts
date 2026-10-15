import { ConfigService } from '@nestjs/config';
import { KafkaOptions, Transport } from '@nestjs/microservices';

/** Tách `KAFKA_BROKERS` (host:port[,host:port]) thành danh sách broker; thiếu cấu hình thì lỗi rõ ràng. */
export function kafkaBrokers(config: ConfigService): string[] {
	const raw = config.get<string>('KAFKA_BROKERS', '');
	const brokers = raw
		.split(',')
		.map((b) => b.trim())
		.filter((b) => b.length > 0);
	if (brokers.length === 0) {
		throw new Error('KAFKA_BROKERS is empty; expected host:port[,host:port]');
	}
	return brokers;
}

/**
 * Cấu hình Kafka server cho hybrid app (`connectMicroservice`).
 * `postfixId: ''` giữ clientId/groupId đúng bằng tên truyền vào (Nest mặc định thêm hậu tố `-server`).
 */
export function buildKafkaServerOptions(
	config: ConfigService,
	groupId: string,
): KafkaOptions {
	return {
		transport: Transport.KAFKA,
		options: {
			client: { clientId: groupId, brokers: kafkaBrokers(config) },
			consumer: { groupId },
			postfixId: '',
			subscribe: { fromBeginning: false },
			run: { autoCommit: true },
		},
	};
}
