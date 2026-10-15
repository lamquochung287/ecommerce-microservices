import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { GetOrdersHandler } from './queries/handlers/get-orders.handler';
import { GetOrderHandler } from './queries/handlers/get-order.handler';
import { GetRefundsHandler } from './queries/handlers/get-refunds.handler';
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
import { CartModule } from './cart/cart.module';
import { ServiceClientsModule } from './clients/clients.module';
import { CheckoutHandler } from './commands/handlers/checkout.handler';
import { PreparePaymentHandler } from './commands/handlers/prepare-payment.handler';
import { OrderCancellationService } from './order-state/order-cancellation.service';
import { OrderPricingService } from './pricing/order-pricing.service';
import { HandlePaymentEventHandler } from './commands/handlers/handle-payment-event.handler';
import { HandleInventoryEventHandler } from './commands/handlers/handle-inventory-event.handler';
import { HandleShippingEventHandler } from './commands/handlers/handle-shipping-event.handler';
import { ShippingEventsConsumer } from './messaging/shipping-events.consumer';
import { PaymentEventsConsumer } from './messaging/payment-events.consumer';
import { InventoryEventsConsumer } from './messaging/inventory-events.consumer';
import { ScheduleModule } from '@nestjs/schedule';
import { CancelOrderHandler } from './commands/handlers/cancel-order.handler';
import { RequestReturnHandler } from './commands/handlers/request-return.handler';
import { ExpirePendingOrdersHandler } from './commands/handlers/expire-pending-orders.handler';
import { CompleteDeliveredOrdersHandler } from './commands/handlers/complete-delivered-orders.handler';
import { OrderLifecycleScheduler } from './jobs/order-lifecycle.scheduler';

export const CommandHandlers = [
	CheckoutHandler,
	PreparePaymentHandler,
	CancelOrderHandler,
	RequestReturnHandler,
	ExpirePendingOrdersHandler,
	CompleteDeliveredOrdersHandler,
	HandlePaymentEventHandler,
	HandleInventoryEventHandler,
	HandleShippingEventHandler,
];
export const QueryHandlers = [
	GetOrdersHandler,
	GetOrderHandler,
	GetRefundsHandler,
];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		CachedModule,
		TypeOrmModule.forFeature([Order, OrderItem, Refund]),
		CqrsModule,
		ScheduleModule.forRoot(),
		HealthModule,
		MessagingModule.forService({ source: OUTBOX_SOURCE.ORDERS }),
		CartModule,
		ServiceClientsModule,
	],
	controllers: [
		OrdersController,
		PaymentEventsConsumer,
		InventoryEventsConsumer,
		ShippingEventsConsumer,
	],
	providers: [
		...CommandHandlers,
		...QueryHandlers,
		OrderTransitionService,
		OrderCancellationService,
		OrderPricingService,
		OrderLifecycleScheduler,
	],
})
export class OrdersModule {}
