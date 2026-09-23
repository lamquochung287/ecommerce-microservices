import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from 'libs/constant/port-tcp.constant';
import { UserModule } from './user/user.module';
import { CachedModule } from '@lib/cached';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/interceptor/idempotency.interceptor';
import { RequestTrackerMiddleware } from './common/middleware/request-tracker.middleware';
import { TransformInterceptor } from './common/interceptor/transform.interceptor';
import { CommonConfigModule } from '@lib/common';
import { ProductModule } from './product/product.module';
import { OrdersModule } from './orders/orders.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigService } from '@nestjs/config';

@Module({
	imports: [
		ClientsModule.register([
			{
				name: NAME_SERVICE_TCP.USER_SERVICE,
				transport: Transport.TCP,
				options: {
					host: 'localhost',
					port: PORT_TCP.USER_TCP_PORT,
				},
			},
			{
				name: NAME_SERVICE_TCP.ORDER_SERVICE,
				transport: Transport.TCP,
				options: {
					host: 'localhost',
					port: PORT_TCP.ORDER_TCP_PORT,
				},
			},
		]),
		CommonConfigModule,
		CachedModule,
		UserModule,
		ProductModule,
		OrdersModule,
		ThrottlerModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				throttlers: [
					{
						ttl: 60000,
						limit: 30,
					},
				],
				storage: new ThrottlerStorageRedisService({
					host: configService.get<string>('REDIS_HOST') || 'localhost',
					port: configService.get<number>('REDIS_PORT') || 6379,
					password: configService.get<string>('REDIS_PASSWORD'),
				}),
			}),
		}),
	],

	controllers: [GatewayController],
	providers: [
		GatewayService,
		{
			provide: APP_INTERCEPTOR,
			useClass: IdempotencyInterceptor,
		},
		{
			provide: APP_INTERCEPTOR,
			useClass: TransformInterceptor,
		},
		{
			provide: APP_GUARD,
			useClass: ThrottlerGuard,
		},
	],
	exports: [ClientsModule],
})

export class GatewayModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer
			.apply(RequestTrackerMiddleware)
			.forRoutes('*');
	}
}

