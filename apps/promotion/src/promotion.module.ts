import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionController } from './promotion.controller';
import { CreateVoucherHandler } from './commands/handlers/create-voucher.handler';
import { ApplyVoucherHandler } from './commands/handlers/apply-voucher.handler';
import { ReserveVoucherHandler } from './commands/handlers/reserve-voucher.handler';
import { ReleaseVoucherHandler } from './commands/handlers/release-voucher.handler';
import { ConfirmVoucherHandler } from './commands/handlers/confirm-voucher.handler';
import { HandleOrderEventMessageHandler } from './commands/handlers/handle-order-event-message.handler';
import { GetVouchersHandler } from './queries/handlers/get-vouchers.handler';
import { GetAvailableVouchersHandler } from './queries/handlers/get-available-vouchers.handler';
import { ValidateVoucherHandler } from './queries/handlers/validate-voucher.handler';
import { Voucher } from './entities/voucher.entity';
import { VoucherRedemption } from './entities/voucher-redemption.entity';
import { OrderEventsConsumer } from './messaging/order-events.consumer';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { MessagingModule } from '@lib/messaging';
import { OUTBOX_SOURCE } from 'libs/constant/kafka.constant';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [
	CreateVoucherHandler,
	ApplyVoucherHandler,
	ReserveVoucherHandler,
	ReleaseVoucherHandler,
	ConfirmVoucherHandler,
	HandleOrderEventMessageHandler,
];
export const QueryHandlers = [
	GetVouchersHandler,
	GetAvailableVouchersHandler,
	ValidateVoucherHandler,
];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([Voucher, VoucherRedemption]),
		CqrsModule,
		HealthModule,
		// Promotion chỉ consume (inbox), không phát event nên không chạy outbox relay.
		MessagingModule.forService({
			source: OUTBOX_SOURCE.PROMOTION,
			relay: false,
		}),
	],
	controllers: [PromotionController, OrderEventsConsumer],
	providers: [...CommandHandlers, ...QueryHandlers],
})
export class PromotionModule {}
