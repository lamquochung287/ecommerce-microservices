import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { Outbox } from '../entities/outbox.entity';
import { OutboxWorker } from './outbox.worker';
import { ORDER_TCP_CLIENT, NOTIFICATION_TCP_CLIENT } from './outbox.constant';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';

@Module({
	imports: [
		TypeOrmModule.forFeature([Outbox]),
		ScheduleModule.forRoot(),
		ClientsModule.register([
			{
				name: ORDER_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.ORDER_TCP_PORT },
			},
			{
				name: NOTIFICATION_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.NOTIFICATION_TCP_PORT },
			},
		]),
	],
	providers: [OutboxWorker],
})
export class OutboxModule {}
