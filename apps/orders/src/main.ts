import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('order-service', 9467);

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
	buildKafkaServerOptions,
	ensureKafkaTopics,
	kafkaBrokers,
} from '@lib/messaging';
import { CONSUMER_GROUP } from 'libs/constant/kafka.constant';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { OrdersModule } from './orders.module';

async function bootstrap() {
	const app = await NestFactory.create(OrdersModule);
	const config = app.get(ConfigService);

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
				port: PORT_TCP.ORDER_TCP_PORT,
			},
		},
		{ inheritAppConfig: true },
	);
	app.connectMicroservice<MicroserviceOptions>(
		buildKafkaServerOptions(config, CONSUMER_GROUP.ORDERS),
		{ inheritAppConfig: true },
	);

	app.enableShutdownHooks();
	await app.startAllMicroservices();
	await app.init();
	console.log(
		`Order microservice is running on port ${PORT_TCP.ORDER_TCP_PORT} (TCP) + Kafka group ${CONSUMER_GROUP.ORDERS}`,
	);
}
bootstrap().catch((err) => {
	console.error(err);
	process.exit(1);
});
