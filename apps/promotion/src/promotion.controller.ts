import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { PROMOTION_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateVoucherCommand } from './commands/create-voucher.command';
import { ApplyVoucherCommand } from './commands/apply-voucher.command';
import { ReserveVoucherCommand } from './commands/reserve-voucher.command';
import { ReleaseVoucherCommand } from './commands/release-voucher.command';
import { GetVouchersQuery } from './queries/get-vouchers.query';
import { GetAvailableVouchersQuery } from './queries/get-available-vouchers.query';
import { ValidateVoucherQuery } from './queries/validate-voucher.query';
import { CreateVoucherDto, ApplyVoucherDto } from './dto/voucher.dto';
import {
	ReleaseVoucherDto,
	ReserveVoucherDto,
	ValidateVoucherDto,
} from './dto/voucher-redemption.dto';

// Gắn Transport.TCP để pattern không bị đăng ký cho Kafka server của hybrid app.
@Controller()
export class PromotionController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.CREATE_VOUCHER },
		Transport.TCP,
	)
	async createVoucher(@Payload() dto: CreateVoucherDto): Promise<unknown> {
		return this.commandBus.execute(new CreateVoucherCommand(dto));
	}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.GET_VOUCHERS },
		Transport.TCP,
	)
	async getVouchers(): Promise<unknown> {
		return this.queryBus.execute(new GetVouchersQuery());
	}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.GET_AVAILABLE_VOUCHERS },
		Transport.TCP,
	)
	async getAvailableVouchers(): Promise<unknown> {
		return this.queryBus.execute(new GetAvailableVouchersQuery());
	}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.APPLY_VOUCHER },
		Transport.TCP,
	)
	async applyVoucher(@Payload() dto: ApplyVoucherDto): Promise<unknown> {
		return this.commandBus.execute(new ApplyVoucherCommand(dto));
	}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.VALIDATE_VOUCHER },
		Transport.TCP,
	)
	async validateVoucher(@Payload() dto: ValidateVoucherDto): Promise<unknown> {
		return this.queryBus.execute(new ValidateVoucherQuery(dto));
	}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.RESERVE_VOUCHER },
		Transport.TCP,
	)
	async reserveVoucher(@Payload() dto: ReserveVoucherDto): Promise<unknown> {
		return this.commandBus.execute(new ReserveVoucherCommand(dto));
	}

	@MessagePattern(
		{ cmd: PROMOTION_MESSAGE_PATTERN.RELEASE_VOUCHER },
		Transport.TCP,
	)
	async releaseVoucher(@Payload() dto: ReleaseVoucherDto): Promise<unknown> {
		return this.commandBus.execute(new ReleaseVoucherCommand(dto.orderId));
	}
}
