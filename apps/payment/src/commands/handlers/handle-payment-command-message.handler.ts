import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { RefundPaymentPayload } from '@lib/messaging';
import { MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { HandlePaymentCommandMessageCommand } from '../handle-payment-command-message.command';
import { CancelPaymentIntentCommand } from '../cancel-payment-intent.command';
import { RefundPaymentCommand } from '../refund-payment.command';

// Định tuyến message trên payment-commands theo `type`; type lạ bị bỏ qua (inbox vẫn đánh dấu đã xử lý).
@CommandHandler(HandlePaymentCommandMessageCommand)
export class HandlePaymentCommandMessageHandler implements ICommandHandler<HandlePaymentCommandMessageCommand> {
	private readonly logger = new Logger(HandlePaymentCommandMessageHandler.name);

	constructor(private readonly commandBus: CommandBus) {}

	async execute(command: HandlePaymentCommandMessageCommand): Promise<void> {
		const { manager, envelope } = command;
		switch (envelope.type) {
			case MESSAGE_TYPE.CANCEL_PAYMENT_INTENT:
				await this.commandBus.execute(
					new CancelPaymentIntentCommand(manager, envelope.orderId),
				);
				return;
			case MESSAGE_TYPE.REFUND_PAYMENT: {
				const payload = (envelope.payload ??
					{}) as Partial<RefundPaymentPayload>;
				await this.commandBus.execute(
					new RefundPaymentCommand(
						manager,
						envelope.orderId,
						Number(payload.amount),
						typeof payload.reason === 'string' ? payload.reason : '',
					),
				);
				return;
			}
			default:
				this.logger.warn(
					`Ignoring unknown payment command type ${envelope.type} (${envelope.eventId})`,
				);
		}
	}
}
