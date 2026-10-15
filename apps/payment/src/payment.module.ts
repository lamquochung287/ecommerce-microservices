import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { OUTBOX_SOURCE } from 'libs/constant/kafka.constant';
import { MessagingModule } from '@lib/messaging';
import { PaymentController } from './payment.controller';
import { ChargePaymentHandler } from './commands/handlers/charge-payment.handler';
import { HandlePaymentWebhookHandler } from './commands/handlers/handle-payment-webhook.handler';
import { CreatePaymentIntentHandler } from './commands/handlers/create-payment-intent.handler';
import { CancelPaymentIntentHandler } from './commands/handlers/cancel-payment-intent.handler';
import { RefundPaymentHandler } from './commands/handlers/refund-payment.handler';
import { SimulatePaymentHandler } from './commands/handlers/simulate-payment.handler';
import { HandlePaymentCommandMessageHandler } from './commands/handlers/handle-payment-command-message.handler';
import { GetTransactionHandler } from './queries/handlers/get-transaction.handler';
import { GetPaymentIntentHandler } from './queries/handlers/get-payment-intent.handler';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentWebhookLog } from './entities/payment-webhook-log.entity';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { SimulatedPaymentProvider } from './providers/simulated-payment.provider';
import { ORDER_TCP_CLIENT } from './order-client.constant';
import { PaymentAutoSimulatorService } from './simulator/payment-auto-simulator.service';
import { PaymentCommandsConsumer } from './messaging/payment-commands.consumer';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [
	ChargePaymentHandler,
	HandlePaymentWebhookHandler,
	CreatePaymentIntentHandler,
	CancelPaymentIntentHandler,
	RefundPaymentHandler,
	SimulatePaymentHandler,
	HandlePaymentCommandMessageHandler,
];
export const QueryHandlers = [GetTransactionHandler, GetPaymentIntentHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([
			PaymentTransaction,
			PaymentWebhookLog,
			PaymentRefund,
		]),
		MessagingModule.forService({ source: OUTBOX_SOURCE.PAYMENT }),
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
	controllers: [PaymentController, PaymentCommandsConsumer],
	providers: [
		...CommandHandlers,
		...QueryHandlers,
		PaymentAutoSimulatorService,
		{
			provide: PAYMENT_PROVIDER,
			useFactory: (config: ConfigService) =>
				new SimulatedPaymentProvider(config),
			inject: [ConfigService],
		},
	],
})
export class PaymentModule {}
