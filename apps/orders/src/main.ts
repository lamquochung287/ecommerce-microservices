import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('order-service', 9467);

import { NestFactory } from '@nestjs/core';
import { OrdersModule } from './orders.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(
		OrdersModule,
		{
			transport: Transport.TCP,
			options: {
				host: 'localhost',
				port: PORT_TCP.ORDER_TCP_PORT,
			},
		},
	);
	await app.listen();
	console.log(`Order microservice is running on port ${PORT_TCP.ORDER_TCP_PORT}`);
}
bootstrap().catch((err) => console.error(err));
