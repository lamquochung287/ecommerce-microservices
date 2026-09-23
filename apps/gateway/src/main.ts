import { setupTracing } from '@lib/common/tracing/tracing';
setupTracing('gateway-service');

import { NestFactory } from '@nestjs/core';
import { GatewayModule } from './gateway.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './common/fliters/http-exception.filter';
import helmet from 'helmet';
import * as compression from 'compression';

async function bootstrap() {
	const app = await NestFactory.create(GatewayModule);
	
	// Security, Compression & CORS
	app.use(helmet());
	app.use(compression());
	app.enableCors();

	const configService = app.get(ConfigService);
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true
		}),
	);
	app.useGlobalFilters(new HttpExceptionFilter());
	const port = configService.get<number>('PORT', 3000);
	await app.listen(port, () => {
		console.log(`Gateway is running on port ${port}`);
	});
}
bootstrap();
