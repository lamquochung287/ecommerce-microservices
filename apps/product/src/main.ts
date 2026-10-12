import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('product-service', 9466);

import { NestFactory } from '@nestjs/core';
import { ProductModule } from './product.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(
		ProductModule,
		{
			transport: Transport.TCP,
			options: {
				host: 'localhost',
				port: PORT_TCP.PRODUCT_TCP_PORT,
			},
		},
	);
	app.enableShutdownHooks();
	await app.listen();
	console.log(
		`Product microservice is running on port ${PORT_TCP.PRODUCT_TCP_PORT}`,
	);
}
bootstrap().catch((err) => console.error(err));
