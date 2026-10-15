import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('promotion-service', 9471);

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PromotionModule } from './promotion.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import {
	buildKafkaServerOptions,
	ensureKafkaTopics,
	kafkaBrokers,
} from '@lib/messaging';
import { CONSUMER_GROUP } from 'libs/constant/kafka.constant';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { PromotionRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	// Hybrid app (không listen HTTP): TCP cho Gateway/Orders + Kafka để nhận order-events.
	const app = await NestFactory.create(PromotionModule);
	const config = app.get(ConfigService);

	app.useGlobalFilters(new PromotionRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);
	app.enableShutdownHooks();

	// Broker tắt auto-create topic: phải đảm bảo topic tồn tại trước khi consumer subscribe.
	await ensureKafkaTopics(
		kafkaBrokers(config),
		config.get<number>('KAFKA_TOPIC_PARTITIONS', 3),
	);

	app.connectMicroservice<MicroserviceOptions>(
		{
			transport: Transport.TCP,
			options: { host: 'localhost', port: PORT_TCP.PROMOTION_TCP_PORT },
		},
		{ inheritAppConfig: true },
	);
	app.connectMicroservice<MicroserviceOptions>(
		buildKafkaServerOptions(config, CONSUMER_GROUP.PROMOTION),
		{ inheritAppConfig: true },
	);

	await app.startAllMicroservices();
	await app.init();
	console.log(
		`Promotion microservice is running on port ${PORT_TCP.PROMOTION_TCP_PORT} (TCP) + Kafka group ${CONSUMER_GROUP.PROMOTION}`,
	);
}
bootstrap().catch((err) => {
	console.error(err);
	process.exit(1);
});
