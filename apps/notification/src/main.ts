import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('notification-service', 9469);

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import {
	buildKafkaServerOptions,
	ensureKafkaTopics,
	kafkaBrokers,
} from '@lib/messaging';
import { CONSUMER_GROUP } from 'libs/constant/kafka.constant';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { NotificationModule } from './notification.module';
import { NotificationRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.create(NotificationModule);
	const config = app.get(ConfigService);

	app.useGlobalFilters(new NotificationRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);

	// Broker tắt auto-create topic: phải đảm bảo topic tồn tại trước khi consumer subscribe.
	await ensureKafkaTopics(
		kafkaBrokers(config),
		config.get<number>('KAFKA_TOPIC_PARTITIONS', 3),
	);

	app.connectMicroservice<MicroserviceOptions>(
		{
			transport: Transport.TCP,
			options: {
				host: 'localhost',
				port: PORT_TCP.NOTIFICATION_TCP_PORT,
			},
		},
		{ inheritAppConfig: true },
	);
	app.connectMicroservice<MicroserviceOptions>(
		buildKafkaServerOptions(config, CONSUMER_GROUP.NOTIFICATION),
		{ inheritAppConfig: true },
	);

	app.enableShutdownHooks();
	await app.startAllMicroservices();
	await app.init();
	console.log(
		`Notification microservice is running on port ${PORT_TCP.NOTIFICATION_TCP_PORT} (TCP) + Kafka group ${CONSUMER_GROUP.NOTIFICATION}`,
	);
}
bootstrap().catch((err) => {
	console.error(err);
	process.exit(1);
});
