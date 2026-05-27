import { NestFactory } from '@nestjs/core';
import { UserModule } from './user.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { UserRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
	const app = await NestFactory.createMicroservice<MicroserviceOptions>(
		UserModule,
		{
			transport: Transport.TCP,
			options: {
				host: 'localhost',
				port: PORT_TCP.USER_TCP_PORT,
			},
		},
	);

	app.useGlobalFilters(new UserRpcExceptionFilter());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
		}),
	);
	await app.listen();
	console.log(`User microservice is running on port ${PORT_TCP.USER_TCP_PORT}`);
}
bootstrap().catch((err) => console.error(err));
