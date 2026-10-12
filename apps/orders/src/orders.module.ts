import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { CreateOrderHandler } from './commands/handlers/create-order.handler';
import { UpdateOrderStatusHandler } from './commands/handlers/update-order-status.handler';
import { CreateRefundHandler } from './commands/handlers/create-refund.handler';
import { ApproveRefundHandler } from './commands/handlers/approve-refund.handler';
import { RejectRefundHandler } from './commands/handlers/reject-refund.handler';
import { GetOrdersHandler } from './queries/handlers/get-orders.handler';
import { GetOrderHandler } from './queries/handlers/get-order.handler';
import { GetRefundsHandler } from './queries/handlers/get-refunds.handler';
import { OrderCreatedHandler } from './events/handlers/order-created.handler';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Refund } from './entities/refund.entity';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { CachedModule } from '@lib/cached';
import { HealthModule } from './health/health.module';
import { OutboxModule } from './outbox/outbox.module';
import { SagaModule } from './saga/saga.module';
import { CartModule } from './cart/cart.module';

export const CommandHandlers = [
	CreateOrderHandler,
	UpdateOrderStatusHandler,
	CreateRefundHandler,
	ApproveRefundHandler,
	RejectRefundHandler,
];
export const QueryHandlers = [
	GetOrdersHandler,
	GetOrderHandler,
	GetRefundsHandler,
];
export const EventHandlers = [OrderCreatedHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		CachedModule,
		TypeOrmModule.forFeature([Order, OrderItem, Refund]),
		CqrsModule,
		HealthModule,
		OutboxModule,
		SagaModule,
		CartModule,
	],
	controllers: [OrdersController],
	providers: [...CommandHandlers, ...QueryHandlers, ...EventHandlers],
})
export class OrdersModule {}
