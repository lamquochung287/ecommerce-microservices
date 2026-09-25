import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { UserModule } from './user/user.module';
import { SharedClientsModule } from './shared-clients.module';
import { CachedModule } from '@lib/cached';
import { MediaModule } from '@lib/media';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/interceptor/idempotency.interceptor';
import { RequestTrackerMiddleware } from './common/middleware/request-tracker.middleware';
import { TransformInterceptor } from './common/interceptor/transform.interceptor';
import { CommonConfigModule } from '@lib/common';
import { ProductModule } from './product/product.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentModule } from './payment/payment.module';
import { ReviewModule } from './review/review.module';
import { PromotionModule } from './promotion/promotion.module';
import { HealthModule } from './health/health.module';
import { TcpResilienceModule } from './common/tcp-resilience.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigService } from '@nestjs/config';

@Module({
	imports: [
		SharedClientsModule,
		CommonConfigModule,
		CachedModule,
		MediaModule,
		TcpResilienceModule,
		UserModule,
		ProductModule,
		OrdersModule,
		PaymentModule,
		ReviewModule,
		PromotionModule,
		HealthModule,
		ThrottlerModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => ({
				throttlers: [
					{
						ttl: 60000,
						limit: 100000,
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
	exports: [],
})

export class GatewayModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer
			.apply(RequestTrackerMiddleware)
			.exclude('health')
			.forRoutes('*');
	}
}

