import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Order, OrderStatus } from '../entities/order.entity';
import { canTransition } from '../order-status.constant';
import { OrderVersionConflictError } from './order-version-conflict.error';

/** Cột được phép ghi kèm khi đổi state; status/version do service này quản lý. */
export type OrderPatch = Partial<
	Omit<Order, 'id' | 'status' | 'version' | 'items' | 'refunds' | 'createdAt'>
>;

export interface OrderOutboxMessage {
	topic: string;
	type: string;
	payload: unknown;
}

export interface OrderTransitionInput {
	order: Order;
	to: OrderStatus;
	patch?: OrderPatch;
	/** Message ghi cùng transaction ngoài OrderStatusChanged mặc định (key luôn là orderId). */
	messages?: OrderOutboxMessage[];
}

/**
 * Điểm duy nhất đổi state của Order: kiểm canTransition rồi UPDATE ... WHERE version = :v.
 * 0 dòng bị ảnh hưởng nghĩa là có bên khác đã đổi đơn; ném lỗi để transaction gọi rollback
 * (kể cả outbox/inbox). Không dùng `save()` vì nó ghi đè mà không kiểm version.
 */
@Injectable()
export class OrderTransitionService {
	constructor(private readonly outboxWriter: OutboxWriter) {}

	async transition(
		manager: EntityManager,
		input: OrderTransitionInput,
	): Promise<Order> {
		const { order, to, patch, messages } = input;
		const from = order.status;

		if (!canTransition(from, to)) {
			throw new RpcException({
				statusCode: 400,
				message: `Không thể chuyển trạng thái từ ${from} sang ${to}`,
			});
		}

		const updated = await this.applyUpdate(manager, order, {
			...patch,
			status: to,
		});

		await this.outboxWriter.append(manager, {
			topic: KAFKA_TOPIC.ORDER_EVENTS,
			type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
			orderId: order.id,
			payload: { userId: order.userId, previousStatus: from, status: to },
		});
		for (const message of messages ?? []) {
			await this.outboxWriter.append(manager, {
				topic: message.topic,
				type: message.type,
				orderId: order.id,
				payload: message.payload,
			});
		}
		return updated;
	}

	/** Đổi cột mà không đổi status (vd refundStatus), vẫn qua cùng cơ chế version. */
	async updateWithVersion(
		manager: EntityManager,
		order: Order,
		patch: OrderPatch,
	): Promise<Order> {
		return this.applyUpdate(manager, order, patch);
	}

	private async applyUpdate(
		manager: EntityManager,
		order: Order,
		changes: OrderPatch & { status?: OrderStatus },
	): Promise<Order> {
		const result = await manager.update(
			Order,
			{ id: order.id, version: order.version },
			{
				...changes,
				version: () => 'version + 1',
			},
		);
		if (!result.affected) {
			throw new OrderVersionConflictError(order.id);
		}
		return Object.assign(
			Object.create(Object.getPrototypeOf(order) as object) as Order,
			order,
			changes,
			{ version: order.version + 1, updatedAt: new Date() },
		);
	}
}
