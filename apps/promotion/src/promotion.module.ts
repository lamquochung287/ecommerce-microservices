import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionController } from './promotion.controller';
import { CreateVoucherHandler } from './commands/handlers/create-voucher.handler';
import { ApplyVoucherHandler } from './commands/handlers/apply-voucher.handler';
import { GetVouchersHandler } from './queries/handlers/get-vouchers.handler';
import { GetAvailableVouchersHandler } from './queries/handlers/get-available-vouchers.handler';
import { Voucher } from './entities/voucher.entity';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [CreateVoucherHandler, ApplyVoucherHandler];
export const QueryHandlers = [GetVouchersHandler, GetAvailableVouchersHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([Voucher]),
		CqrsModule,
		HealthModule,
	],
	controllers: [PromotionController],
	providers: [...CommandHandlers, ...QueryHandlers],
})
export class PromotionModule {}
