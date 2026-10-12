import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { PaymentController } from './payment.controller';
import { ChargePaymentHandler } from './commands/handlers/charge-payment.handler';
import { HandlePaymentWebhookHandler } from './commands/handlers/handle-payment-webhook.handler';
import { GetTransactionHandler } from './queries/handlers/get-transaction.handler';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentWebhookLog } from './entities/payment-webhook-log.entity';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { SimulatedPaymentProvider } from './providers/simulated-payment.provider';
import { ORDER_TCP_CLIENT } from './order-client.constant';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [
	ChargePaymentHandler,
	HandlePaymentWebhookHandler,
];
export const QueryHandlers = [GetTransactionHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([PaymentTransaction, PaymentWebhookLog]),
		CqrsModule,
		HealthModule,
		ClientsModule.register([
			{
				name: ORDER_TCP_CLIENT,
				transport: Transport.TCP,
				options: { host: 'localhost', port: PORT_TCP.ORDER_TCP_PORT },
			},
		]),
	],
	controllers: [PaymentController],
	providers: [
		...CommandHandlers,
		...QueryHandlers,
		{ provide: PAYMENT_PROVIDER, useClass: SimulatedPaymentProvider },
	],
})
export class PaymentModule {}
