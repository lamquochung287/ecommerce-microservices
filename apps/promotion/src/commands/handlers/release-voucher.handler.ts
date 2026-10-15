import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DataSource, EntityManager } from 'typeorm';
import { ReleaseVoucherResult } from '../../dto/voucher-redemption.dto';
import { Voucher } from '../../entities/voucher.entity';
import {
	VoucherRedemption,
	VoucherRedemptionStatus,
} from '../../entities/voucher-redemption.entity';
import { ReleaseVoucherCommand } from '../release-voucher.command';

/**
 * Trả lượt voucher của đơn chưa thanh toán: RESERVED -> RELEASED và usageCount -= 1. Redemption ở trạng thái
 * khác (CONFIRMED, RELEASED) hoặc không tồn tại là no-op nên gọi lặp an toàn.
 * Thứ tự khoá luôn là voucher rồi redemption (giống reserve) để hai luồng không khoá chéo nhau.
 */
@CommandHandler(ReleaseVoucherCommand)
export class ReleaseVoucherHandler implements ICommandHandler<ReleaseVoucherCommand> {
	constructor(private readonly dataSource: DataSource) {}

	execute(command: ReleaseVoucherCommand): Promise<ReleaseVoucherResult> {
		if (command.manager) return this.release(command.manager, command.orderId);
		return this.dataSource.transaction((manager) =>
			this.release(manager, command.orderId),
		);
	}

	private async release(
		manager: EntityManager,
		orderId: string,
	): Promise<ReleaseVoucherResult> {
		const peek = await manager.findOne(VoucherRedemption, {
			where: { orderId },
		});
		if (!peek || peek.status !== VoucherRedemptionStatus.RESERVED) {
			return { released: false };
		}

		const voucher = await manager.findOne(Voucher, {
			where: { id: peek.voucherId },
			lock: { mode: 'pessimistic_write' },
		});
		// Đọc lại dưới khoá: confirm/release song song có thể đã đổi trạng thái sau lần đọc đầu.
		const redemption = await manager.findOne(VoucherRedemption, {
			where: { orderId },
			lock: { mode: 'pessimistic_write' },
		});
		if (!redemption || redemption.status !== VoucherRedemptionStatus.RESERVED) {
			return { released: false };
		}

		redemption.status = VoucherRedemptionStatus.RELEASED;
		await manager.save(redemption);
		if (voucher) {
			voucher.usageCount = Math.max(0, voucher.usageCount - 1);
			await manager.save(voucher);
		}
		return { released: true };
	}
}
