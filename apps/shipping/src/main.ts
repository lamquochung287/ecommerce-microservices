import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('shipping-service', 9473);

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
import { ShippingModule } from './shipping.module';
import { ShippingRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	// Hybrid app (không listen HTTP): TCP cho webhook/simulator + Kafka cho command bất đồng bộ.
	const app = await NestFactory.create(ShippingModule);
	const config = app.get(ConfigService);

	app.useGlobalFilters(new ShippingRpcExceptionFilter());
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
			options: { host: 'localhost', port: PORT_TCP.SHIPPING_TCP_PORT },
		},
		{ inheritAppConfig: true },
	);
	app.connectMicroservice<MicroserviceOptions>(
		buildKafkaServerOptions(config, CONSUMER_GROUP.SHIPPING),
		{ inheritAppConfig: true },
	);

	await app.startAllMicroservices();
	await app.init();
	console.log(
		`Shipping microservice is running on port ${PORT_TCP.SHIPPING_TCP_PORT} (TCP) + Kafka group ${CONSUMER_GROUP.SHIPPING}`,
	);
}
bootstrap().catch((err) => {
	console.error(err);
	process.exit(1);
});
