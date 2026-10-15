import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { PaymentEventsController } from './payment-events.controller';
import { CreateOrderHandler } from './commands/handlers/create-order.handler';
import { UpdateOrderStatusHandler } from './commands/handlers/update-order-status.handler';
import { ConfirmOrderPaymentHandler } from './commands/handlers/confirm-order-payment.handler';
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
import { MessagingModule } from '@lib/messaging';
import { OUTBOX_SOURCE } from 'libs/constant/kafka.constant';
import { OrderTransitionService } from './order-state/order-transition.service';
import { HealthModule } from './health/health.module';
import { SagaModule } from './saga/saga.module';
import { CartModule } from './cart/cart.module';
import { ServiceClientsModule } from './clients/clients.module';
import { CheckoutHandler } from './commands/handlers/checkout.handler';
import { PreparePaymentHandler } from './commands/handlers/prepare-payment.handler';
import { OrderCancellationService } from './order-state/order-cancellation.service';
import { OrderPricingService } from './pricing/order-pricing.service';
import { HandlePaymentEventHandler } from './commands/handlers/handle-payment-event.handler';
import { HandleInventoryEventHandler } from './commands/handlers/handle-inventory-event.handler';
import { PaymentEventsConsumer } from './messaging/payment-events.consumer';
import { InventoryEventsConsumer } from './messaging/inventory-events.consumer';

export const CommandHandlers = [
	CheckoutHandler,
	PreparePaymentHandler,
	HandlePaymentEventHandler,
	HandleInventoryEventHandler,
	CreateOrderHandler,
	UpdateOrderStatusHandler,
	ConfirmOrderPaymentHandler,
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
		MessagingModule.forService({ source: OUTBOX_SOURCE.ORDERS }),
		SagaModule,
		CartModule,
		ServiceClientsModule,
	],
	controllers: [
		OrdersController,
		PaymentEventsController,
		PaymentEventsConsumer,
		InventoryEventsConsumer,
	],
	providers: [
		...CommandHandlers,
		...QueryHandlers,
		...EventHandlers,
		OrderTransitionService,
		OrderCancellationService,
		OrderPricingService,
	],
})
export class OrdersModule {}
