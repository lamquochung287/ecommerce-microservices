import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('payment-service', 9468);

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
import { PaymentModule } from './payment.module';
import { PaymentRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.create(PaymentModule);
	const config = app.get(ConfigService);

	app.useGlobalFilters(new PaymentRpcExceptionFilter());
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
				port: PORT_TCP.PAYMENT_TCP_PORT,
			},
		},
		{ inheritAppConfig: true },
	);
	app.connectMicroservice<MicroserviceOptions>(
		buildKafkaServerOptions(config, CONSUMER_GROUP.PAYMENT),
		{ inheritAppConfig: true },
	);

	app.enableShutdownHooks();
	await app.startAllMicroservices();
	await app.init();
	console.log(
		`Payment microservice is running on port ${PORT_TCP.PAYMENT_TCP_PORT} (TCP) + Kafka group ${CONSUMER_GROUP.PAYMENT}`,
	);
}
bootstrap().catch((err) => {
	console.error(err);
	process.exit(1);
});
