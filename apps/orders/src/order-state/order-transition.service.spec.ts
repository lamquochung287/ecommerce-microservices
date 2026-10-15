// Mock manager/outbox trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { RpcException } from '@nestjs/microservices';
import { EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderTransitionService } from './order-transition.service';
import { OrderVersionConflictError } from './order-version-conflict.error';

function makeOrder(status: OrderStatus, version = 1): Order {
	return { id: 'o-1', userId: 'u-1', status, version } as Order;
}

function setup(affected: number) {
	const update = jest.fn().mockResolvedValue({ affected });
	const append = jest.fn().mockResolvedValue('evt');
	const manager = { update } as unknown as EntityManager;
	const service = new OrderTransitionService({
		append,
	} as unknown as OutboxWriter);
	return { service, manager, update, append };
}

describe('OrderTransitionService', () => {
	it('affected 1: UPDATE theo version, outbox OrderStatusChanged + messages, version+1', async () => {
		const { service, manager, update, append } = setup(1);
		const order = makeOrder(OrderStatus.PENDING_PAYMENT, 3);
		const paidAt = new Date();

		const result = await service.transition(manager, {
			order,
			to: OrderStatus.PAID,
			patch: { paidAt },
			messages: [
				{
					topic: KAFKA_TOPIC.ORDER_EVENTS,
					type: MESSAGE_TYPE.ORDER_PAID,
					payload: { x: 1 },
				},
			],
		});

		expect(update).toHaveBeenCalledTimes(1);
		const [entity, criteria, set] = update.mock.calls[0];
		expect(entity).toBe(Order);
		expect(criteria).toEqual({ id: 'o-1', version: 3 });
		expect(set.status).toBe(OrderStatus.PAID);
		expect(set.paidAt).toBe(paidAt);
		expect(typeof set.version).toBe('function');

		expect(append).toHaveBeenCalledTimes(2);
		expect(append.mock.calls[0][0]).toBe(manager);
		expect(append.mock.calls[0][1]).toMatchObject({
			topic: KAFKA_TOPIC.ORDER_EVENTS,
			type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
			orderId: 'o-1',
			payload: {
				userId: 'u-1',
				previousStatus: OrderStatus.PENDING_PAYMENT,
				status: OrderStatus.PAID,
			},
		});
		expect(append.mock.calls[1][1]).toMatchObject({
			type: MESSAGE_TYPE.ORDER_PAID,
			orderId: 'o-1',
			payload: { x: 1 },
		});

		expect(result.status).toBe(OrderStatus.PAID);
		expect(result.version).toBe(4);
		expect(result.paidAt).toBe(paidAt);
		expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
	});

	it('affected 0: ném OrderVersionConflictError 409, không ghi outbox', async () => {
		const { service, manager, append } = setup(0);
		const promise = service.transition(manager, {
			order: makeOrder(OrderStatus.PAID),
			to: OrderStatus.FULFILLING,
		});

		await expect(promise).rejects.toBeInstanceOf(OrderVersionConflictError);
		await expect(promise).rejects.toMatchObject({
			error: { statusCode: 409 },
		});
		expect(append).not.toHaveBeenCalled();
	});

	it('canTransition sai: 400, không UPDATE, không outbox', async () => {
		const { service, manager, update, append } = setup(1);
		const promise = service.transition(manager, {
			order: makeOrder(OrderStatus.SHIPPED),
			to: OrderStatus.CANCELLED,
		});

		await expect(promise).rejects.toBeInstanceOf(RpcException);
		await expect(promise).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
		expect(update).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it('updateWithVersion: tăng version, không đổi status, không outbox', async () => {
		const { service, manager, update, append } = setup(1);
		const result = await service.updateWithVersion(
			manager,
			makeOrder(OrderStatus.CANCELLED, 5),
			{ refundedAmount: 200000 },
		);

		expect(update.mock.calls[0][1]).toEqual({ id: 'o-1', version: 5 });
		expect(update.mock.calls[0][2]).not.toHaveProperty('status');
		expect(append).not.toHaveBeenCalled();
		expect(result.version).toBe(6);
		expect(result.status).toBe(OrderStatus.CANCELLED);
		expect(result.refundedAmount).toBe(200000);
	});

	it('updateWithVersion lệch version: ném OrderVersionConflictError', async () => {
		const { service, manager } = setup(0);
		await expect(
			service.updateWithVersion(manager, makeOrder(OrderStatus.PAID), {
				cancelReason: 'USER',
			}),
		).rejects.toBeInstanceOf(OrderVersionConflictError);
	});
});
