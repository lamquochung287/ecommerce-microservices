import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
	VoucherRedemption,
	VoucherRedemptionStatus,
} from '../../entities/voucher-redemption.entity';
import { ConfirmVoucherCommand } from '../confirm-voucher.command';

/**
 * Đơn đã thanh toán: RESERVED -> CONFIRMED (lượt không bao giờ được trả nữa). UPDATE có điều kiện trạng thái
 * nên nguyên tử với release song song; đơn không có voucher / đã RELEASED / đã CONFIRMED đều là no-op.
 */
@CommandHandler(ConfirmVoucherCommand)
export class ConfirmVoucherHandler implements ICommandHandler<ConfirmVoucherCommand> {
	async execute(
		command: ConfirmVoucherCommand,
	): Promise<{ confirmed: boolean }> {
		const result = await command.manager.update(
			VoucherRedemption,
			{
				orderId: command.orderId,
				status: VoucherRedemptionStatus.RESERVED,
			},
			{ status: VoucherRedemptionStatus.CONFIRMED },
		);
		return { confirmed: (result.affected ?? 0) > 0 };
	}
}
