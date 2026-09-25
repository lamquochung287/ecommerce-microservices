import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PROMOTION_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateVoucherCommand } from './commands/create-voucher.command';
import { ApplyVoucherCommand } from './commands/apply-voucher.command';
import { GetVouchersQuery } from './queries/get-vouchers.query';
import { GetAvailableVouchersQuery } from './queries/get-available-vouchers.query';
import { CreateVoucherDto, ApplyVoucherDto } from './dto/voucher.dto';

@Controller()
export class PromotionController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: PROMOTION_MESSAGE_PATTERN.CREATE_VOUCHER })
	async createVoucher(@Payload() dto: CreateVoucherDto) {
		return this.commandBus.execute(new CreateVoucherCommand(dto));
	}

	@MessagePattern({ cmd: PROMOTION_MESSAGE_PATTERN.GET_VOUCHERS })
	async getVouchers() {
		return this.queryBus.execute(new GetVouchersQuery());
	}

	@MessagePattern({ cmd: PROMOTION_MESSAGE_PATTERN.GET_AVAILABLE_VOUCHERS })
	async getAvailableVouchers() {
		return this.queryBus.execute(new GetAvailableVouchersQuery());
	}

	@MessagePattern({ cmd: PROMOTION_MESSAGE_PATTERN.APPLY_VOUCHER })
	async applyVoucher(@Payload() dto: ApplyVoucherDto) {
		return this.commandBus.execute(new ApplyVoucherCommand(dto));
	}
}
