import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import {
	INVENTORY_CLIENT,
	PAYMENT_CLIENT,
	PRODUCT_CLIENT,
	PROMOTION_CLIENT,
} from './client-tokens.constant';
import { InventoryClient } from './inventory.client';
import { PaymentClient } from './payment.client';
import { ProductClient } from './product.client';
import { PromotionClient } from './promotion.client';

@Module({
	imports: [
		ClientsModule.register([
			{
				name: INVENTORY_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.INVENTORY_TCP_PORT },
			},
			{
				name: PAYMENT_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.PAYMENT_TCP_PORT },
			},
			{
				name: PRODUCT_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.PRODUCT_TCP_PORT },
			},
			{
				name: PROMOTION_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.PROMOTION_TCP_PORT },
			},
		]),
	],
	providers: [InventoryClient, PaymentClient, ProductClient, PromotionClient],
	exports: [InventoryClient, PaymentClient, ProductClient, PromotionClient],
})
export class ServiceClientsModule {}
