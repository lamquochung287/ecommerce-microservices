import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { RefundController } from './refund.controller';
import { CartController } from './cart.controller';
import { OrdersService } from './orders.service';
import { ProductModule } from '../product/product.module';

@Module({
	imports: [ProductModule],
	controllers: [OrdersController, RefundController, CartController],
	providers: [OrdersService],
})
export class OrdersModule {}
