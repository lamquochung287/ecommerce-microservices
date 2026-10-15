import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
	KafkaConsumerRunner,
	MessageEnvelope,
	OutboxWriter,
} from '@lib/messaging';
import type {
	ShipmentCreatedPayload,
	ShipmentDeliveredPayload,
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
import { HandleShippingEventCommand } from '../handle-shipping-event.command';

/**
 * Xử lý event trên `shipping-events` trong transaction của runner. Mỗi lần chạy đọc lại đơn và quyết định theo
 * trạng thái hiện tại; lệch version (vd user huỷ vừa commit) thì transition ném lỗi, runner retry và lần sau
 * thấy trạng thái mới. Invariant: vận đơn chỉ tồn tại cho đơn SHIPPED trở đi, nên ShipmentCreated tới đơn đã
 * CANCELLED phải được bù trừ bằng CancelShipment.
 */
@CommandHandler(HandleShippingEventCommand)
export class HandleShippingEventHandler implements ICommandHandler<HandleShippingEventCommand> {
	private readonly logger = new Logger(HandleShippingEventHandler.name);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly orderTransition: OrderTransitionService,
		private readonly cancellation: OrderCancellationService,
		private readonly outboxWriter: OutboxWriter,
	) {}

	execute(command: HandleShippingEventCommand): Promise<void> {
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
			case MESSAGE_TYPE.SHIPMENT_CREATED:
				return this.onCreated(manager, envelope);
			case MESSAGE_TYPE.SHIPMENT_DELIVERED:
				return this.onDelivered(manager, envelope);
			case MESSAGE_TYPE.SHIPMENT_FAILED:
				return this.onFailed(manager, envelope);
			default:
				this.logger.warn(
					`Bỏ qua event lạ "${envelope.type}" (eventId=${envelope.eventId}) trên ${KAFKA_TOPIC.SHIPPING_EVENTS}`,
				);
		}
	}

	private async onCreated(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;

		if (order.status === OrderStatus.CANCELLED) {
			// Huỷ thắng race: vận đơn vừa tạo không còn đơn nào cần, huỷ để hãng không giao hàng.
			// Không đổi status; CancelShipment idempotent ở Shipping.
			this.logger.warn(
				`ShipmentCreated cho đơn ${order.id} đã CANCELLED: gửi CancelShipment bù trừ`,
			);
			await this.outboxWriter.append(manager, {
				topic: KAFKA_TOPIC.SHIPPING_COMMANDS,
				type: MESSAGE_TYPE.CANCEL_SHIPMENT,
				orderId: order.id,
				payload: {},
			});
			return;
		}
		if (order.status !== OrderStatus.FULFILLING) {
			this.logger.debug(
				`ShipmentCreated cho đơn ${order.id} đang ${order.status}: bỏ qua`,
			);
			return;
		}

		const payload = (envelope.payload ?? {}) as Partial<ShipmentCreatedPayload>;
		if (!payload.trackingCode) {
			// Payload hỏng không thể tự lành bằng retry; ném để runner đưa vào DLQ thay vì SHIPPED thiếu mã.
			throw new Error(
				`ShipmentCreated (eventId=${envelope.eventId}) thiếu trackingCode`,
			);
		}
		await this.orderTransition.transition(manager, {
			order,
			to: OrderStatus.SHIPPED,
			patch: { trackingCode: payload.trackingCode },
		});
	}

	private async onDelivered(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;
		if (order.status !== OrderStatus.SHIPPED) {
			this.logger.warn(
				`ShipmentDelivered cho đơn ${order.id} đang ${order.status}: bỏ qua`,
			);
			return;
		}

		const payload = (envelope.payload ??
			{}) as Partial<ShipmentDeliveredPayload>;
		const parsed = payload.deliveredAt
			? new Date(payload.deliveredAt)
			: new Date(Number.NaN);
		if (Number.isNaN(parsed.getTime())) {
			throw new Error(
				`ShipmentDelivered (eventId=${envelope.eventId}) có deliveredAt không hợp lệ`,
			);
		}
		// deliveredAt là mốc bắt đầu cửa sổ đổi trả, lấy theo hãng vận chuyển chứ không theo giờ xử lý.
		await this.orderTransition.transition(manager, {
			order,
			to: OrderStatus.DELIVERED,
			patch: { deliveredAt: parsed },
		});
	}

	private async onFailed(
		manager: EntityManager,
		envelope: MessageEnvelope,
	): Promise<void> {
		const order = await this.findOrder(manager, envelope);
		if (!order) return;

		if (order.status === OrderStatus.CANCELLED) {
			this.logger.debug(
				`ShipmentFailed cho đơn ${order.id} đã CANCELLED: đã hoàn ở luồng huỷ, bỏ qua`,
			);
			return;
		}
		if (order.status !== OrderStatus.FULFILLING) {
			this.logger.error(
				`ShipmentFailed cho đơn ${order.id} đang ${order.status}: trạng thái không hợp lệ, bỏ qua`,
			);
			return;
		}
		// Kho đã commit nên phải nhập lại; vận đơn không tạo được nên không cần huỷ; đơn đã thanh toán nên voucher không trả.
		await this.cancellation.cancelPaid(
			manager,
			order,
			OrderCancelReason.SHIPMENT_FAILED,
			{ restock: true, cancelShipment: false },
		);
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
