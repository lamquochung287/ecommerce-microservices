import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('promotion-service', 9471);

import { NestFactory } from '@nestjs/core';
import { PromotionModule } from './promotion.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { PromotionRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(
		PromotionModule,
		{
			transport: Transport.TCP,
			options: {
				host: 'localhost',
				port: PORT_TCP.PROMOTION_TCP_PORT,
			},
		},
	);

	app.useGlobalFilters(new PromotionRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);
	app.enableShutdownHooks();
	await app.listen();
	console.log(
		`Promotion microservice is running on port ${PORT_TCP.PROMOTION_TCP_PORT}`,
	);
}
bootstrap().catch((err) => console.error(err));
