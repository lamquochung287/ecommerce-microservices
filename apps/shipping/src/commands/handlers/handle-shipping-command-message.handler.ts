import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import {
	HandleResult,
	InboxService,
	KafkaConsumerRunner,
	MessageEnvelope,
	OutboxWriter,
} from '@lib/messaging';
import type { ShipmentFailedPayload } from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import { DataSource, EntityManager } from 'typeorm';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import { DeliveryTimerService } from '../../simulator/delivery-timer.service';
import { CancelShipmentCommand } from '../cancel-shipment.command';
import { CreateShipmentCommand } from '../create-shipment.command';
import { HandleShippingCommandMessage } from '../handle-shipping-command-message.command';
import { CreateShipmentResult } from './create-shipment.handler';

const MAX_REASON_LENGTH = 500;

/**
 * Xử lý command trên `shipping-commands` trong transaction của runner (inbox + vận đơn + outbox chung một TX).
 * Carrier lỗi => runner retry rồi đưa vào DLQ; khi hết lượt `markFailed` ghi vận đơn FAILED và phát
 * ShipmentFailed trong TX riêng để Orders biết mà bù trừ. Type lạ chỉ log (inbox vẫn ghi, không DLQ).
 */
@CommandHandler(HandleShippingCommandMessage)
export class HandleShippingCommandMessageHandler implements ICommandHandler<HandleShippingCommandMessage> {
	private readonly logger = new Logger(
		HandleShippingCommandMessageHandler.name,
	);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly commandBus: CommandBus,
		private readonly timer: DeliveryTimerService,
		private readonly inbox: InboxService,
		private readonly outbox: OutboxWriter,
		@InjectDataSource() private readonly dataSource: DataSource,
	) {}

	execute(command: HandleShippingCommandMessage): Promise<void> {
		return this.runner.run({
			consumer: CONSUMER_GROUP.SHIPPING,
			topic: command.topic,
			message: command.message,
			handle: (manager, envelope) => this.dispatch(manager, envelope),
			onExhausted: (envelope, error) => this.markFailed(envelope, error),
		});
	}

	private async dispatch(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void | HandleResult> {
		const { orderId } = envelope;
		switch (envelope.type) {
			case MESSAGE_TYPE.CREATE_SHIPMENT: {
				const result = await this.commandBus.execute<
					CreateShipmentCommand,
					CreateShipmentResult
				>(new CreateShipmentCommand(manager, orderId, envelope.payload));
				// Hẹn giờ giao chỉ sau khi TX commit: rollback/retry không để lại timer cho vận đơn chưa tồn tại.
				return result.created
					? { afterCommit: () => Promise.resolve(this.timer.schedule(orderId)) }
					: undefined;
			}
			case MESSAGE_TYPE.CANCEL_SHIPMENT:
				await this.commandBus.execute(
					new CancelShipmentCommand(manager, orderId),
				);
				return;
			default:
				this.logger.warn(
					`Bỏ qua command lạ "${envelope.type}" (eventId=${envelope.eventId}) trên ${KAFKA_TOPIC.SHIPPING_COMMANDS}`,
				);
		}
	}

	private async markFailed(
		envelope: MessageEnvelope,
		error: Error,
	): Promise<void> {
		if (envelope.type !== MESSAGE_TYPE.CREATE_SHIPMENT) return;

		const reason = error.message.slice(0, MAX_REASON_LENGTH);
		await this.dataSource.transaction(async (manager) => {
			// Các lần thử đã rollback nên inbox chưa ghi; ghi ở đây để giao lại sau này không phát ShipmentFailed lần nữa.
			const acquired = await this.inbox.tryAcquire(
				manager,
				CONSUMER_GROUP.SHIPPING,
				envelope.eventId,
			);
			if (!acquired) return;

			const existing = await manager.findOne(Shipment, {
				where: { orderId: envelope.orderId },
			});
			if (existing) return;

			await manager.insert(Shipment, {
				orderId: envelope.orderId,
				status: ShipmentStatus.FAILED,
				failureReason: reason,
			});
			const event: ShipmentFailedPayload = { reason };
			await this.outbox.append(manager, {
				topic: KAFKA_TOPIC.SHIPPING_EVENTS,
				type: MESSAGE_TYPE.SHIPMENT_FAILED,
				orderId: envelope.orderId,
				payload: event,
			});
		});
	}
}
