import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, PORT_TCP } from 'libs/constant/port-tcp.constant';
import { UserModule } from './user/user.module';
import { CachedModule } from '@lib/cached';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/interceptor/idempotency.interceptor';
import { RequestTrackerMiddleware } from './common/middleware/request-tracker.middleware';
import { CommonConfigModule } from '@lib/common';

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
			{
				name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
				transport: Transport.TCP,
				options: {
					host: 'localhost',
					port: PORT_TCP.PRODUCT_TCP_PORT,
				},
			},
		]),
		CommonConfigModule,
		CachedModule,
		UserModule,
	],

	controllers: [GatewayController],
	providers: [
		GatewayService,
		{
			provide: APP_INTERCEPTOR,
			useClass: IdempotencyInterceptor,
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

