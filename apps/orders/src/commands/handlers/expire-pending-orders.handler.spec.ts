// Mock jest.fn() và raw params có kiểu any/unknown theo thiết kế.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Logger } from '@nestjs/common';
import { OutboxWriter } from '@lib/messaging';
import { MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { ExpirePendingOrdersCommand } from '../expire-pending-orders.command';
import { ExpirePendingOrdersHandler } from './expire-pending-orders.handler';

function makeOrder(id: string, extra: Record<string, unknown> = {}): Order {
	return {
		id,
		userId: 'u-1',
		status: OrderStatus.PENDING_PAYMENT,
		version: 2,
		expiresAt: new Date(Date.now() - 60_000),
		voucherCode: null,
		...extra,
	} as unknown as Order;
}

/** candidates: kết quả find; fresh: map id -> đơn đọc lại trong TX; affectedById: kết quả UPDATE theo đơn. */
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
	const handler = new ExpirePendingOrdersHandler(
		dataSource as never,
		new OrderCancellationService(
			new OrderTransitionService(outbox as unknown as OutboxWriter),
		),
	);
	return { handler, find, manager, outbox };
}

const appended = (outbox: { append: jest.Mock }) =>
	(outbox.append.mock.calls as [unknown, any][]).map(([, input]) => input);

describe('ExpirePendingOrdersHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	it('đơn quá hạn: CANCELLED(PAYMENT_EXPIRED) + ReleaseInventory + CancelPaymentIntent + OrderCancelled{paid:false}', async () => {
		const { handler, outbox, manager, find } = setup([makeOrder('o-1')]);
		const result = await handler.execute(new ExpirePendingOrdersCommand(100));

		expect(result).toEqual({ cancelled: 1, skipped: 0, failed: 0 });
		const query = find.mock.calls[0][1];
		expect(query.where.status).toBe(OrderStatus.PENDING_PAYMENT);
		expect(query.take).toBe(100);

		const [, where, set] = manager.update.mock.calls[0] as unknown as [
			unknown,
			unknown,
			any,
		];
		expect(where).toEqual({ id: 'o-1', version: 2 });
		expect(set).toMatchObject({
			status: OrderStatus.CANCELLED,
			cancelReason: 'PAYMENT_EXPIRED',
		});
		const items = appended(outbox);
		expect(items.map((i) => i.type)).toEqual([
			MESSAGE_TYPE.ORDER_STATUS_CHANGED,
			MESSAGE_TYPE.RELEASE_INVENTORY,
			MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
			MESSAGE_TYPE.ORDER_CANCELLED,
		]);
		expect(items[3].payload).toMatchObject({
			paid: false,
			cancelReason: 'PAYMENT_EXPIRED',
		});
	});

	it('đơn lệch version bị bỏ qua, đơn khác vẫn được xử lý', async () => {
		const { handler, outbox } = setup(
			[makeOrder('o-1'), makeOrder('o-2'), makeOrder('o-3')],
			{ affectedById: { 'o-1': 0 } },
		);
		const result = await handler.execute(new ExpirePendingOrdersCommand(100));

		expect(result).toEqual({ cancelled: 2, skipped: 1, failed: 0 });
		const cancelledIds = appended(outbox)
			.filter((i) => i.type === MESSAGE_TYPE.ORDER_CANCELLED)
			.map((i) => i.orderId);
		expect(cancelledIds).toEqual(['o-2', 'o-3']);
	});

	it('đơn vừa được thanh toán (đọc lại thấy PAID) hoặc đã xoá: bỏ qua, không UPDATE', async () => {
		const { handler, manager } = setup([makeOrder('o-1'), makeOrder('o-2')], {
			fresh: {
				'o-1': makeOrder('o-1', { status: OrderStatus.PAID }),
				'o-2': null,
			},
		});
		const result = await handler.execute(new ExpirePendingOrdersCommand(100));
		expect(result).toEqual({ cancelled: 0, skipped: 2, failed: 0 });
		expect(manager.update).not.toHaveBeenCalled();
	});

	it('lỗi bất ngờ của một đơn: đếm failed, không chặn đơn sau', async () => {
		const { handler, manager } = setup([makeOrder('o-1'), makeOrder('o-2')]);
		manager.update.mockRejectedValueOnce(new Error('db down'));
		const result = await handler.execute(new ExpirePendingOrdersCommand(100));
		expect(result).toEqual({ cancelled: 1, skipped: 0, failed: 1 });
	});

	it('không có đơn quá hạn: không làm gì', async () => {
		const { handler, outbox } = setup([]);
		const result = await handler.execute(new ExpirePendingOrdersCommand(100));
		expect(result).toEqual({ cancelled: 0, skipped: 0, failed: 0 });
		expect(outbox.append).not.toHaveBeenCalled();
	});
});
