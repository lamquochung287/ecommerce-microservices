import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { RefundController } from './refund.controller';
import { CartController } from './cart.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersService } from './orders.service';

@Module({
	controllers: [
		CustomerOrdersController,
		OrdersController,
		RefundController,
		CartController,
	],
	providers: [OrdersService],
})
export class OrdersModule {}
