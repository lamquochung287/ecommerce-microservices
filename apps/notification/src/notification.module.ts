import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { NotificationController } from './notification.controller';
import { OrderEventsController } from './order-events.controller';
import { SentNotification } from './entities/sent-notification.entity';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { PUSH_PROVIDER } from './providers/push-provider.interface';
import { SimulatedEmailProvider } from './providers/simulated-email.provider';
import { SimulatedPushProvider } from './providers/simulated-push.provider';
import { USER_TCP_CLIENT } from './user-client.constant';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([SentNotification]),
		HealthModule,
		ClientsModule.register([
			{
				name: USER_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.USER_TCP_PORT },
			},
		]),
	],
	controllers: [NotificationController, OrderEventsController],
	providers: [
		{ provide: EMAIL_PROVIDER, useClass: SimulatedEmailProvider },
		{ provide: PUSH_PROVIDER, useClass: SimulatedPushProvider },
	],
})
export class NotificationModule {}
