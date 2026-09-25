import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('review-service', 9470);

import { NestFactory } from '@nestjs/core';
import { ReviewModule } from './review.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { ReviewRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(ReviewModule, {
		transport: Transport.TCP,
		options: {
			host: 'localhost',
			port: PORT_TCP.REVIEW_TCP_PORT,
		},
	});

	app.useGlobalFilters(new ReviewRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);
	app.enableShutdownHooks();
	await app.listen();
	console.log(`Review microservice is running on port ${PORT_TCP.REVIEW_TCP_PORT}`);
}
bootstrap().catch((err) => console.error(err));
