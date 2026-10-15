import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { KafkaConsumerRunner, MessageEnvelope } from '@lib/messaging';
import type {
	CreateShipmentPayload,
	InventoryCommitFailedPayload,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import { EntityManager } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderCancelReason } from '../../order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { HandleInventoryEventCommand } from '../handle-inventory-event.command';

/**
 * Xử lý event trên `inventory-events` trong transaction của runner. Như consumer payment: đọc lại đơn mỗi lần
 * chạy, quyết định theo trạng thái hiện tại, lệch version thì runner retry. Đơn đã CANCELLED (user huỷ khi đang
 * PAID) không bao giờ được tạo vận đơn.
 */
@CommandHandler(HandleInventoryEventCommand)
export class HandleInventoryEventHandler implements ICommandHandler<HandleInventoryEventCommand> {
	private readonly logger = new Logger(HandleInventoryEventHandler.name);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly orderTransition: OrderTransitionService,
		private readonly cancellation: OrderCancellationService,
	) {}

	execute(command: HandleInventoryEventCommand): Promise<void> {
		return this.runner.run({
			consumer: CONSUMER_GROUP.ORDERS,
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
			case MESSAGE_TYPE.INVENTORY_COMMITTED:
				return this.onCommitted(manager, envelope);
			case MESSAGE_TYPE.INVENTORY_COMMIT_FAILED:
				return this.onCommitFailed(manager, envelope);
			default:
				this.logger.warn(
					`Bỏ qua event lạ "${envelope.type}" (eventId=${envelope.eventId}) trên ${KAFKA_TOPIC.INVENTORY_EVENTS}`,
				);
		}
	}

	private async onCommitted(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;

		if (order.status === OrderStatus.CANCELLED) {
			this.logger.warn(
				`InventoryCommitted cho đơn ${order.id} đã CANCELLED: không tạo vận đơn (RestockInventory đã được gửi khi huỷ)`,
			);
			return;
		}
		if (order.status !== OrderStatus.PAID) {
			this.logger.debug(
				`InventoryCommitted cho đơn ${order.id} đang ${order.status}: bỏ qua`,
			);
			return;
		}

		await this.orderTransition.transition(manager, {
			order,
			to: OrderStatus.FULFILLING,
			messages: [
				{
					topic: KAFKA_TOPIC.SHIPPING_COMMANDS,
					type: MESSAGE_TYPE.CREATE_SHIPMENT,
					payload: this.buildShipment(order),
				},
			],
		});
	}

	private async onCommitFailed(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;
		if (order.status !== OrderStatus.PAID) {
			this.logger.debug(
				`InventoryCommitFailed cho đơn ${order.id} đang ${order.status}: bỏ qua`,
			);
			return;
		}
		const payload = (envelope.payload ??
			{}) as Partial<InventoryCommitFailedPayload>;
		this.logger.warn(
			`Commit kho thất bại cho đơn ${order.id} (${payload.reason ?? 'không rõ lý do'}): huỷ và hoàn tiền`,
		);
		// Kho không commit được nên không có gì để nhập lại; chưa có vận đơn nên không cần huỷ vận đơn.
		await this.cancellation.cancelPaid(
			manager,
			order,
			OrderCancelReason.INVENTORY_COMMIT_FAILED,
			{ restock: false },
		);
	}

	private buildShipment(order: Order): CreateShipmentPayload {
		return {
			recipient: {
				recipientName: order.recipientName,
				recipientPhone: order.recipientPhone,
				addressLine1: order.addressLine1,
				...(order.addressLine2 ? { addressLine2: order.addressLine2 } : {}),
				city: order.city,
				...(order.province ? { province: order.province } : {}),
				...(order.postalCode ? { postalCode: order.postalCode } : {}),
				country: order.country,
			},
			items: order.items.map((item) => ({
				productId: item.productId,
				quantity: item.quantity,
			})),
		};
	}

	private async findOrder(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<Order | null> {
		const order = await manager.findOne(Order, {
			where: { id: envelope.orderId },
		});
		if (!order) {
			// Không retry: đơn không tồn tại thì lần sau cũng vậy. Inbox vẫn đánh dấu đã xử lý.
			this.logger.error(
				`${envelope.type} (eventId=${envelope.eventId}) cho đơn không tồn tại ${envelope.orderId}`,
			);
		}
		return order;
	}
}
