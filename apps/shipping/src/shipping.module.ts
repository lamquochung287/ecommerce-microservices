import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonConfigModule } from '@lib/common';
import { DatabaseModule } from '@lib/database';
import { MessagingModule } from '@lib/messaging';
import { OUTBOX_SOURCE } from 'libs/constant/kafka.constant';
import { CancelShipmentHandler } from './commands/handlers/cancel-shipment.handler';
import { CreateShipmentHandler } from './commands/handlers/create-shipment.handler';
import { HandleShippingCommandMessageHandler } from './commands/handlers/handle-shipping-command-message.handler';
import { HandleShippingWebhookHandler } from './commands/handlers/handle-shipping-webhook.handler';
import { SimulateDeliveryHandler } from './commands/handlers/simulate-delivery.handler';
import { Shipment } from './entities/shipment.entity';
import { HealthModule } from './health/health.module';
import { ShippingCommandsConsumer } from './messaging/shipping-commands.consumer';
import { SHIPPING_PROVIDER } from './providers/shipping-provider.interface';
import { SimulatedShippingProvider } from './providers/simulated-shipping.provider';
import { GetShipmentHandler } from './queries/handlers/get-shipment.handler';
import { ShippingController } from './shipping.controller';
import { DeliveryTimerService } from './simulator/delivery-timer.service';

export const CommandHandlers = [
	CreateShipmentHandler,
	CancelShipmentHandler,
	HandleShippingWebhookHandler,
	SimulateDeliveryHandler,
	HandleShippingCommandMessageHandler,
];
export const QueryHandlers = [GetShipmentHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([Shipment]),
		CqrsModule,
		HealthModule,
		MessagingModule.forService({ source: OUTBOX_SOURCE.SHIPPING }),
	],
	controllers: [ShippingController, ShippingCommandsConsumer],
	providers: [
		{ provide: SHIPPING_PROVIDER, useClass: SimulatedShippingProvider },
		DeliveryTimerService,
		...CommandHandlers,
		...QueryHandlers,
	],
})
export class ShippingModule {}
