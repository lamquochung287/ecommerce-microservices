import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateVoucherCommand } from '../create-voucher.command';
import { Voucher } from '../../entities/voucher.entity';

@CommandHandler(CreateVoucherCommand)
export class CreateVoucherHandler implements ICommandHandler<CreateVoucherCommand> {
	constructor(
		@InjectRepository(Voucher)
		private readonly voucherRepository: Repository<Voucher>,
	) {}

	async execute(command: CreateVoucherCommand) {
		const { dto } = command;
		const voucher = this.voucherRepository.create({
			code: dto.code,
			discountType: dto.discountType,
			discountValue: dto.discountValue,
			minOrderValue: dto.minOrderValue,
			expiresAt: new Date(dto.expiresAt),
			usageLimit: dto.usageLimit,
		});
		return this.voucherRepository.save(voucher);
	}
}
