import { setupTracing } from '@lib/common/tracing/tracing';
// Tracing phải khởi động trước mọi import khác nên chưa có ConfigService; đọc env trực tiếp ở đây.
// Chạy nhiều instance gateway cùng network thì mỗi instance đặt GATEWAY_METRICS_PORT riêng.
setupTracing('gateway-service', Number(process.env.GATEWAY_METRICS_PORT) || 9464);

import { NestFactory } from '@nestjs/core';
import { GatewayModule } from './gateway.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './common/fliters/http-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';

async function bootstrap() {
	const app = await NestFactory.create(GatewayModule);
	const configService = app.get(ConfigService);

	// Security & Compression
	app.use(helmet());
	app.use(compression());

	// CORS origin đọc từ .env (CORS_ORIGINS, phân tách bởi dấu phẩy) thay vì mở toàn bộ (*) như trước.
	const corsOrigins = configService.get<string>(
		'CORS_ORIGINS',
		'http://localhost:3000',
	);
	app.enableCors({
		origin: corsOrigins.split(',').map((origin) => origin.trim()),
		credentials: true,
	});

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		}),
	);
	app.useGlobalFilters(new HttpExceptionFilter());
	app.enableShutdownHooks();

	const swaggerConfig = new DocumentBuilder()
		.setTitle('Ecommerce API')
		.setDescription('API Gateway cho hệ thống ecommerce microservices')
		.setVersion('1.0')
		.addBearerAuth()
		// Mọi route (trừ /health) bắt buộc header x-api-key — xem RequestTrackerMiddleware.
		.addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
		.addSecurityRequirements('api-key')
		.build();
	const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup('api/docs', app, swaggerDocument);

	const port = configService.get<number>('GATEWAY_PORT', 3000);
	await app.listen(port, () => {
		console.log(`Gateway is running on port ${port}`);
		console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
	});
}
bootstrap();
