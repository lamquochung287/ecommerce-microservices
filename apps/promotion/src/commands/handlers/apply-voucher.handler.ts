import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { ApplyVoucherCommand } from '../apply-voucher.command';
import { Voucher } from '../../entities/voucher.entity';
import { evaluateVoucher } from '../../domain/voucher-rules';

@CommandHandler(ApplyVoucherCommand)
export class ApplyVoucherHandler implements ICommandHandler<ApplyVoucherCommand> {
	constructor(private readonly dataSource: DataSource) {}

	async execute(command: ApplyVoucherCommand) {
		const { code, orderValue } = command.dto;

		return this.dataSource.transaction(async (manager) => {
			// SELECT FOR UPDATE để tránh 2 request cùng lúc apply voucher vượt usageLimit (giống pattern
			// trừ kho ở Product service).
			const voucher = await manager.findOne(Voucher, {
				where: { code },
				lock: { mode: 'pessimistic_write' },
			});

			const discountAmount = evaluateVoucher(voucher, orderValue);

			// evaluateVoucher đã ném khi voucher null nên ở đây chắc chắn có voucher.
			const locked = voucher as Voucher;
			locked.usageCount += 1;
			await manager.save(locked);

			return {
				code: locked.code,
				discountAmount,
				finalAmount: orderValue - discountAmount,
			};
		});
	}
}
