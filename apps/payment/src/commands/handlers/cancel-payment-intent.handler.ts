import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CancelPaymentIntentCommand } from '../cancel-payment-intent.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';

@CommandHandler(CancelPaymentIntentCommand)
export class CancelPaymentIntentHandler implements ICommandHandler<CancelPaymentIntentCommand> {
	// UPDATE có điều kiện status=PENDING là nguyên tử: nếu webhook đang giữ khoá dòng và chuyển sang SUCCEEDED,
	// UPDATE này đọc lại điều kiện sau khi webhook commit và không đổi gì (intent đã thu tiền không bị huỷ).
	async execute(
		command: CancelPaymentIntentCommand,
	): Promise<{ cancelled: boolean }> {
		const result = await command.manager.update(
			PaymentTransaction,
			{
				orderId: command.orderId,
				status: PaymentTransactionStatus.PENDING,
			},
			{ status: PaymentTransactionStatus.CANCELLED },
		);
		return { cancelled: (result.affected ?? 0) > 0 };
	}
}
