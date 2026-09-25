import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('notification-service', 9469);

import { NestFactory } from '@nestjs/core';
import { NotificationModule } from './notification.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { NotificationRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(NotificationModule, {
		transport: Transport.TCP,
		options: {
			host: 'localhost',
			port: PORT_TCP.NOTIFICATION_TCP_PORT,
		},
	});

	app.useGlobalFilters(new NotificationRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);
	app.enableShutdownHooks();
	await app.listen();
	console.log(`Notification microservice is running on port ${PORT_TCP.NOTIFICATION_TCP_PORT}`);
}
bootstrap().catch((err) => console.error(err));
