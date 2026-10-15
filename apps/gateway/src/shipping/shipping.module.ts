import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingWebhookController } from './shipping-webhook.controller';
import { ShipmentController } from './shipment.controller';

@Module({
	controllers: [ShippingWebhookController, ShipmentController],
	providers: [ShippingService],
})
export class ShippingModule {}
