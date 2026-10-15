// Mock jest.fn() và raw params có kiểu any/unknown theo thiết kế.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConfigService } from '@nestjs/config';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Order, OrderStatus } from '../../entities/order.entity';
import { Refund, RefundStatus } from '../../entities/refund.entity';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { RequestReturnCommand } from '../request-return.command';
import { RequestReturnHandler } from './request-return.handler';

const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const DAY = 24 * 60 * 60 * 1000;

function makeOrder(extra: Record<string, unknown> = {}): Order {
	return {
		id: ORDER,
		userId: USER,
		status: OrderStatus.DELIVERED,
		version: 5,
		totalAmount: '230000.00',
		shippingFee: '30000.00',
		deliveredAt: new Date(Date.now() - 6 * DAY),
		items: [],
		...extra,
	} as unknown as Order;
}

function setup(
	order: Order | null,
	options: { affected?: number; windowDays?: number } = {},
) {
	const manager = {
		findOne: jest.fn().mockResolvedValue(order),
		update: jest.fn().mockResolvedValue({ affected: options.affected ?? 1 }),
		insert: jest.fn().mockResolvedValue({}),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const config = {
		get: (_key: string, fallback: number) => options.windowDays ?? fallback,
	} as unknown as ConfigService;
	const handler = new RequestReturnHandler(
		dataSource as never,
		new OrderTransitionService(outbox as unknown as OutboxWriter),
		config,
	);
	const requestReturn = (payload: Record<string, unknown> = {}) =>
		handler.execute(
			new RequestReturnCommand({
				orderId: ORDER,
				userId: USER,
				reason: 'Hàng lỗi',
				...payload,
			}),
		);
	return { requestReturn, manager, outbox };
}

const appended = (outbox: { append: jest.Mock }) =>
	(outbox.append.mock.calls as [unknown, any][]).map(([, input]) => input);

describe('RequestReturnHandler', () => {
	it('DELIVERED ngày 6: REFUNDING + Refund PENDING + RefundPayment(total - ship, RETURN)', async () => {
		const { requestReturn, manager, outbox } = setup(makeOrder());
		const result = await requestReturn();

		const [, where, set] = manager.update.mock.calls[0];
		expect(where).toEqual({ id: ORDER, version: 5 });
		expect(set.status).toBe(OrderStatus.REFUNDING);

		expect(manager.insert).toHaveBeenCalledWith(Refund, {
			order: { id: ORDER },
			amount: 200000,
			reason: 'Hàng lỗi',
			status: RefundStatus.PENDING,
		});

		const refund = appended(outbox).find(
			(i) => i.type === MESSAGE_TYPE.REFUND_PAYMENT,
		);
		expect(refund).toMatchObject({
			topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
			orderId: ORDER,
			payload: { amount: 200000, reason: 'RETURN' },
		});
		// Kho chưa nhập lại: chỉ sau khi nhận PaymentRefunded.
		expect(appended(outbox).map((i) => i.type)).not.toContain(
			MESSAGE_TYPE.RESTOCK_INVENTORY,
		);
		expect(result).toEqual({
			orderId: ORDER,
			status: OrderStatus.REFUNDING,
			refundAmount: 200000,
		});
	});

	it('ngày 8: 400 "Quá thời hạn đổi trả", không đổi đơn', async () => {
		const { requestReturn, manager, outbox } = setup(
			makeOrder({ deliveredAt: new Date(Date.now() - 8 * DAY) }),
		);
		await expect(requestReturn()).rejects.toMatchObject({
			error: { statusCode: 400, message: 'Quá thời hạn đổi trả' },
		});
		expect(manager.update).not.toHaveBeenCalled();
		expect(manager.insert).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('cửa sổ cấu hình được: ORDER_RETURN_WINDOW_DAYS=3 thì ngày 4 bị từ chối', async () => {
		const { requestReturn } = setup(
			makeOrder({ deliveredAt: new Date(Date.now() - 4 * DAY) }),
			{ windowDays: 3 },
		);
		await expect(requestReturn()).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
	});

	it('COMPLETED: 400 "Đơn đã hoàn tất, không thể hoàn hàng"', async () => {
		const { requestReturn } = setup(
			makeOrder({ status: OrderStatus.COMPLETED }),
		);
		await expect(requestReturn()).rejects.toMatchObject({
			error: {
				statusCode: 400,
				message: 'Đơn đã hoàn tất, không thể hoàn hàng',
			},
		});
	});

	it.each([
		OrderStatus.SHIPPED,
		OrderStatus.PAID,
		OrderStatus.REFUNDING,
		OrderStatus.CANCELLED,
	])('%s: 400', async (status) => {
		const { requestReturn, manager } = setup(makeOrder({ status }));
		await expect(requestReturn()).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
		expect(manager.update).not.toHaveBeenCalled();
	});

	it('DELIVERED nhưng thiếu deliveredAt: 400', async () => {
		const { requestReturn } = setup(makeOrder({ deliveredAt: null }));
		await expect(requestReturn()).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
	});

	it('đơn của user khác / không tồn tại: 404', async () => {
		await expect(
			setup(makeOrder()).requestReturn({ userId: OTHER }),
		).rejects.toMatchObject({ error: { statusCode: 404 } });
		await expect(setup(null).requestReturn()).rejects.toMatchObject({
			error: { statusCode: 404 },
		});
	});

	it('lệch version: 409, không ghi Refund, không outbox', async () => {
		const { requestReturn, manager, outbox } = setup(makeOrder(), {
			affected: 0,
		});
		await expect(requestReturn()).rejects.toMatchObject({
			error: { statusCode: 409 },
		});
		expect(manager.insert).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('reason rỗng hoặc quá 500 ký tự: 400', async () => {
		const { requestReturn, manager } = setup(makeOrder());
		await expect(requestReturn({ reason: '   ' })).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
		await expect(
			requestReturn({ reason: 'x'.repeat(501) }),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
		expect(manager.findOne).not.toHaveBeenCalled();
	});
});
