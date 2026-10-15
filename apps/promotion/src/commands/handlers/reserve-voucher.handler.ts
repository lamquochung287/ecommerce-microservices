import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { evaluateVoucher } from '../../domain/voucher-rules';
import { ValidateVoucherResult } from '../../dto/voucher-redemption.dto';
import { Voucher } from '../../entities/voucher.entity';
import {
	VoucherRedemption,
	VoucherRedemptionStatus,
} from '../../entities/voucher-redemption.entity';
import { ReserveVoucherCommand } from '../reserve-voucher.command';

/**
 * Giữ một lượt voucher cho một đơn. Khoá `pessimistic_write` trên dòng voucher nên usageCount không bao giờ
 * vượt usageLimit khi nhiều đơn giữ lượt song song; usageCount và redemption đổi trong cùng một transaction.
 * Idempotent theo orderId: gọi lại không tăng usageCount lần hai.
 */
@CommandHandler(ReserveVoucherCommand)
export class ReserveVoucherHandler implements ICommandHandler<ReserveVoucherCommand> {
	constructor(private readonly dataSource: DataSource) {}

	execute(command: ReserveVoucherCommand): Promise<ValidateVoucherResult> {
		const { code, orderId, userId, orderValue } = command.dto;

		return this.dataSource.transaction(async (manager) => {
			const voucher = await manager.findOne(Voucher, {
				where: { code },
				lock: { mode: 'pessimistic_write' },
			});

			// Kiểm tra redemption đã có TRƯỚC khi kiểm lượt: lần giữ lượt trước có thể đã làm voucher hết lượt.
			const existing = await manager.findOne(VoucherRedemption, {
				where: { orderId },
			});
			if (existing) {
				if (existing.code !== code) {
					throw new RpcException({
						statusCode: 409,
						message: 'Order already holds a different voucher',
					});
				}
				if (existing.status === VoucherRedemptionStatus.RELEASED) {
					throw new RpcException({
						statusCode: 409,
						message: 'Voucher reservation for this order was released',
					});
				}
				return {
					code: existing.code,
					discountAmount: Number(existing.discountAmount),
				};
			}

			const discountAmount = evaluateVoucher(voucher, orderValue);

			// evaluateVoucher đã ném khi voucher null.
			const locked = voucher as Voucher;
			locked.usageCount += 1;
			await manager.save(locked);
			await manager.insert(VoucherRedemption, {
				voucherId: locked.id,
				code: locked.code,
				orderId,
				userId,
				discountAmount,
				status: VoucherRedemptionStatus.RESERVED,
			});

			return { code: locked.code, discountAmount };
		});
	}
}
