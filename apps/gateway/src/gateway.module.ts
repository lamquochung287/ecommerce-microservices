import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule } from '@nestjs/config';
import { NAME_SERVICE_TCP, PORT_TCP } from 'libs/constant/port-tcp.constant';

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
		ConfigModule.forRoot({
			isGlobal: true,
			envFilePath: '.env',
		}),
	],
	controllers: [GatewayController],
	providers: [GatewayService],
})
export class GatewayModule {}
