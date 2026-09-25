import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { PRODUCT_TCP_CLIENT } from './product-client.constant';
import { PAYMENT_TCP_CLIENT } from './payment-client.constant';
import { InventoryReservationService } from './inventory-reservation.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { TcpPaymentProvider } from './tcp-payment.provider';

@Module({
	imports: [
		ClientsModule.register([
			{
				name: PRODUCT_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.PRODUCT_TCP_PORT },
			},
			{
				name: PAYMENT_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.PAYMENT_TCP_PORT },
			},
		]),
	],
	providers: [
		InventoryReservationService,
		{ provide: PAYMENT_PROVIDER, useClass: TcpPaymentProvider },
	],
	exports: [InventoryReservationService, PAYMENT_PROVIDER],
})
export class SagaModule {}
