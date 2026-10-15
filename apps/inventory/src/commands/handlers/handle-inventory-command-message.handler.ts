import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
	KafkaConsumerRunner,
	MessageEnvelope,
	OutboxWriter,
} from '@lib/messaging';
import type {
	InventoryCommittedPayload,
	InventoryCommitFailedPayload,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import { EntityManager } from 'typeorm';
import { ReservationService } from '../../domain/reservation.service';
import { HandleInventoryCommandMessage } from '../handle-inventory-command-message.command';

/**
 * Xử lý command trên `inventory-commands` trong transaction của runner (inbox + đổi kho + outbox chung một TX).
 * Type lạ chỉ log và coi như đã xử lý (inbox đã ghi) để không DLQ command của phiên bản khác.
 * Lỗi kỹ thuật được ném ra để runner retry rồi đưa vào DLQ; không phát event bù vì Orders không đổi trạng
 * thái khi không nhận được kết quả.
 */
@CommandHandler(HandleInventoryCommandMessage)
export class HandleInventoryCommandMessageHandler implements ICommandHandler<HandleInventoryCommandMessage> {
	private readonly logger = new Logger(
		HandleInventoryCommandMessageHandler.name,
	);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly reservations: ReservationService,
		private readonly outbox: OutboxWriter,
	) {}

	execute(command: HandleInventoryCommandMessage): Promise<void> {
		return this.runner.run({
			consumer: CONSUMER_GROUP.INVENTORY,
			topic: command.topic,
			message: command.message,
			handle: (manager, envelope) => this.dispatch(manager, envelope),
		});
	}

	private async dispatch(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const { orderId } = envelope;
		switch (envelope.type) {
			case MESSAGE_TYPE.COMMIT_INVENTORY: {
				const result = await this.reservations.commit(manager, orderId);
				if (result.outcome === 'FAILED') {
					const payload: InventoryCommitFailedPayload = {
						reason: result.reason,
					};
					await this.publish(
						manager,
						MESSAGE_TYPE.INVENTORY_COMMIT_FAILED,
						orderId,
						payload,
					);
				} else {
					// ALREADY_COMMITTED cũng phát lại: lần trước có thể đã mất event, Orders xử lý idempotent.
					const payload: InventoryCommittedPayload = {};
					await this.publish(
						manager,
						MESSAGE_TYPE.INVENTORY_COMMITTED,
						orderId,
						payload,
					);
				}
				return;
			}
			case MESSAGE_TYPE.RELEASE_INVENTORY:
				await this.reservations.release(manager, orderId);
				return;
			case MESSAGE_TYPE.RESTOCK_INVENTORY:
				await this.reservations.restock(manager, orderId);
				return;
			default:
				this.logger.warn(
					`Bỏ qua command lạ "${envelope.type}" (eventId=${envelope.eventId}) trên ${KAFKA_TOPIC.INVENTORY_COMMANDS}`,
				);
		}
	}

	private async publish(
		manager: EntityManager,
		type: string,
		orderId: string,
		payload: InventoryCommittedPayload | InventoryCommitFailedPayload,
	): Promise<void> {
		await this.outbox.append(manager, {
			topic: KAFKA_TOPIC.INVENTORY_EVENTS,
			type,
			orderId,
			payload,
		});
	}
}
