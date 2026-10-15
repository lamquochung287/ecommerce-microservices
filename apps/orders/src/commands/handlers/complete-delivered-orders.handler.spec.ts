// Mock jest.fn() và raw params có kiểu any/unknown theo thiết kế.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxWriter } from '@lib/messaging';
import { MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { CompleteDeliveredOrdersCommand } from '../complete-delivered-orders.command';
import { CompleteDeliveredOrdersHandler } from './complete-delivered-orders.handler';

const DAY = 24 * 60 * 60 * 1000;

function makeOrder(id: string, extra: Record<string, unknown> = {}): Order {
	return {
		id,
		userId: 'u-1',
		status: OrderStatus.DELIVERED,
		version: 4,
		deliveredAt: new Date(Date.now() - 8 * DAY),
		...extra,
	} as unknown as Order;
}

function setup(
	candidates: Order[],
	options: {
		fresh?: Record<string, Order | null>;
		affectedById?: Record<string, number>;
	} = {},
) {
	const find = jest.fn().mockResolvedValue(candidates);
	const manager = {
		findOne: jest.fn((_entity: unknown, { where }: { where: { id: string } }) =>
			Promise.resolve(
				options.fresh && where.id in options.fresh
					? options.fresh[where.id]
					: (candidates.find((c) => c.id === where.id) ?? null),
			),
		),
		update: jest.fn((_e: unknown, where: { id: string }) =>
			Promise.resolve({ affected: options.affectedById?.[where.id] ?? 1 }),
		),
	};
	const dataSource = {
		manager: { find },
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const config = {
		get: (_key: string, fallback: number) => fallback,
	} as unknown as ConfigService;
	const handler = new CompleteDeliveredOrdersHandler(
		dataSource as never,
		new OrderTransitionService(outbox as unknown as OutboxWriter),
		config,
	);
	return { handler, find, manager, outbox };
}

describe('CompleteDeliveredOrdersHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	it('chỉ chọn DELIVERED có deliveredAt <= now - 7 ngày (REFUNDING và DELIVERED mới không nằm trong truy vấn)', async () => {
		const { handler, find } = setup([]);
		const before = Date.now();
		await handler.execute(new CompleteDeliveredOrdersCommand(100));

		const query = find.mock.calls[0][1];
		expect(query.where.status).toBe(OrderStatus.DELIVERED);
		expect(query.take).toBe(100);
		// FindOperator LessThanOrEqual: giá trị = cutoff = now - 7 ngày.
		const cutoff = (query.where.deliveredAt.value as Date).getTime();
		expect(cutoff).toBeLessThanOrEqual(before - 7 * DAY);
		expect(cutoff).toBeGreaterThan(before - 7 * DAY - 5_000);
	});

	it('DELIVERED quá 7 ngày: -> COMPLETED qua version, outbox OrderStatusChanged', async () => {
		const { handler, manager, outbox } = setup([makeOrder('o-1')]);
		const result = await handler.execute(
			new CompleteDeliveredOrdersCommand(100),
		);

		expect(result).toEqual({ completed: 1, skipped: 0, failed: 0 });
		const [, where, set] = manager.update.mock.calls[0] as unknown as [
			unknown,
			unknown,
			any,
		];
		expect(where).toEqual({ id: 'o-1', version: 4 });
		expect(set.status).toBe(OrderStatus.COMPLETED);
		const types = (outbox.append.mock.calls as [unknown, any][]).map(
			([, i]) => i.type,
		);
		expect(types).toEqual([MESSAGE_TYPE.ORDER_STATUS_CHANGED]);
	});

	it('đơn đọc lại thấy REFUNDING hoặc deliveredAt mới hơn cutoff: bỏ qua, không UPDATE', async () => {
		const { handler, manager } = setup([makeOrder('o-1'), makeOrder('o-2')], {
			fresh: {
				'o-1': makeOrder('o-1', { status: OrderStatus.REFUNDING }),
				'o-2': makeOrder('o-2', {
					deliveredAt: new Date(Date.now() - 6 * DAY),
				}),
			},
		});
		const result = await handler.execute(
			new CompleteDeliveredOrdersCommand(100),
		);
		expect(result).toEqual({ completed: 0, skipped: 2, failed: 0 });
		expect(manager.update).not.toHaveBeenCalled();
	});

	it('lệch version (user vừa hoàn hàng): bỏ qua, đơn khác vẫn xử lý', async () => {
		const { handler } = setup([makeOrder('o-1'), makeOrder('o-2')], {
			affectedById: { 'o-1': 0 },
		});
		const result = await handler.execute(
			new CompleteDeliveredOrdersCommand(100),
		);
		expect(result).toEqual({ completed: 1, skipped: 1, failed: 0 });
	});

	it('lỗi bất ngờ của một đơn: đếm failed, không chặn đơn sau', async () => {
		const { handler, manager } = setup([makeOrder('o-1'), makeOrder('o-2')]);
		manager.update.mockRejectedValueOnce(new Error('db down'));
		const result = await handler.execute(
			new CompleteDeliveredOrdersCommand(100),
		);
		expect(result).toEqual({ completed: 1, skipped: 0, failed: 1 });
	});
});
