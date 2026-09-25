import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { CreateOrderHandler } from './commands/handlers/create-order.handler';
import { UpdateOrderStatusHandler } from './commands/handlers/update-order-status.handler';
import { GetOrdersHandler } from './queries/handlers/get-orders.handler';
import { GetOrderHandler } from './queries/handlers/get-order.handler';
import { OrderCreatedHandler } from './events/handlers/order-created.handler';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';
import { OutboxModule } from './outbox/outbox.module';

export const CommandHandlers = [CreateOrderHandler, UpdateOrderStatusHandler];
export const QueryHandlers = [GetOrdersHandler, GetOrderHandler];
export const EventHandlers = [OrderCreatedHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([Order, OrderItem]),
		CqrsModule,
		HealthModule,
		OutboxModule,
	],
	controllers: [OrdersController],
	providers: [...CommandHandlers, ...QueryHandlers, ...EventHandlers],
})
export class OrdersModule {}
