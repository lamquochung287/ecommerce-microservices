import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { ApplyVoucherCommand } from '../apply-voucher.command';
import { Voucher, DiscountType } from '../../entities/voucher.entity';

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

			if (!voucher) {
				throw new RpcException({
					statusCode: 404,
					message: 'Voucher not found',
				});
			}
			if (voucher.expiresAt.getTime() < Date.now()) {
				throw new RpcException({
					statusCode: 400,
					message: 'Voucher has expired',
				});
			}
			if (voucher.usageCount >= voucher.usageLimit) {
				throw new RpcException({
					statusCode: 400,
					message: 'Voucher usage limit reached',
				});
			}
			if (orderValue < Number(voucher.minOrderValue)) {
				throw new RpcException({
					statusCode: 400,
					message: `Order value must be at least ${voucher.minOrderValue} to use this voucher`,
				});
			}

			const discountAmount =
				voucher.discountType === DiscountType.PERCENTAGE
					? Math.round(
							orderValue * (Number(voucher.discountValue) / 100) * 100,
						) / 100
					: Math.min(Number(voucher.discountValue), orderValue);

			voucher.usageCount += 1;
			await manager.save(voucher);

			return {
				code: voucher.code,
				discountAmount,
				finalAmount: orderValue - discountAmount,
			};
		});
	}
}
