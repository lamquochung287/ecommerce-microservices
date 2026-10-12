import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('payment-service', 9468);

import { NestFactory } from '@nestjs/core';
import { PaymentModule } from './payment.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { PaymentRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(
		PaymentModule,
		{
			transport: Transport.TCP,
			options: {
				host: 'localhost',
				port: PORT_TCP.PAYMENT_TCP_PORT,
			},
		},
	);

	app.useGlobalFilters(new PaymentRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);
	app.enableShutdownHooks();
	await app.listen();
	console.log(
		`Payment microservice is running on port ${PORT_TCP.PAYMENT_TCP_PORT}`,
	);
}
bootstrap().catch((err) => console.error(err));
