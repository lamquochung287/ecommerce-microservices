import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { KafkaConsumerRunner, MessageEnvelope } from '@lib/messaging';
import type { OrderCancelledPayload } from '@lib/messaging';
import { CONSUMER_GROUP, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { EntityManager } from 'typeorm';
import { ConfirmVoucherCommand } from '../confirm-voucher.command';
import { HandleOrderEventMessage } from '../handle-order-event-message.command';
import { ReleaseVoucherCommand } from '../release-voucher.command';

/**
 * Xử lý `order-events` trong transaction của runner (inbox + đổi redemption cùng một TX): eventId trùng là no-op.
 * Chỉ OrderPaid (confirm) và OrderCancelled{paid:false} (trả lượt) có tác dụng; OrderCancelled{paid:true} và
 * mọi type khác bị bỏ qua vì voucher không được trả sau khi đơn đã thanh toán.
 */
@CommandHandler(HandleOrderEventMessage)
export class HandleOrderEventMessageHandler implements ICommandHandler<HandleOrderEventMessage> {
	private readonly logger = new Logger(HandleOrderEventMessageHandler.name);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly commandBus: CommandBus,
	) {}

	execute(command: HandleOrderEventMessage): Promise<void> {
		return this.runner.run({
			consumer: CONSUMER_GROUP.PROMOTION,
			topic: command.topic,
			message: command.message,
			handle: (manager, envelope) => this.dispatch(manager, envelope),
		});
	}

	private async dispatch(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		switch (envelope.type) {
			case MESSAGE_TYPE.ORDER_PAID:
				await this.commandBus.execute(
					new ConfirmVoucherCommand(manager, envelope.orderId),
				);
				return;
			case MESSAGE_TYPE.ORDER_CANCELLED: {
				const payload =
					envelope.payload as Partial<OrderCancelledPayload> | null;
				// Thiếu/sai `paid` => không chắc đơn đã thanh toán hay chưa nên giữ nguyên lượt (an toàn hơn trả nhầm).
				if (payload?.paid !== false) return;
				await this.commandBus.execute(
					new ReleaseVoucherCommand(envelope.orderId, manager),
				);
				return;
			}
			default:
				this.logger.debug(
					`Bỏ qua event ${envelope.type} (eventId=${envelope.eventId})`,
				);
		}
	}
}
