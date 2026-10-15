import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentSimulatorController } from './payment-simulator.controller';
import { PaymentService } from './payment.service';

@Module({
	imports: [],
	controllers: [
		PaymentController,
		PaymentWebhookController,
		PaymentSimulatorController,
	],
	providers: [PaymentService],
	exports: [PaymentService],
})
export class PaymentModule {}
