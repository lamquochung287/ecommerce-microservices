import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { CartController } from './cart.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersService } from './orders.service';

@Module({
	controllers: [CustomerOrdersController, OrdersController, CartController],
	providers: [OrdersService],
})
export class OrdersModule {}
