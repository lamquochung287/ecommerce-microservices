// Mock jest.fn() và raw params có kiểu any/unknown theo thiết kế.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import {
	Order,
	OrderRefundStatus,
	OrderStatus,
} from '../../entities/order.entity';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { CancelOrderCommand } from '../cancel-order.command';
import { CancelOrderHandler } from './cancel-order.handler';

const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function makeOrder(extra: Record<string, unknown> = {}): Order {
	return {
		id: ORDER,
		userId: USER,
		status: OrderStatus.PAID,
		version: 3,
		totalAmount: '230000.00',
		shippingFee: '30000.00',
		refundStatus: OrderRefundStatus.NONE,
		voucherCode: null,
		cancelReason: null,
		items: [],
		...extra,
	} as unknown as Order;
}

function setup(order: Order | null, affected = 1) {
	const manager = {
		findOne: jest.fn().mockResolvedValue(order),
		update: jest.fn().mockResolvedValue({ affected }),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const transition = new OrderTransitionService(
		outbox as unknown as OutboxWriter,
	);
	const handler = new CancelOrderHandler(
		dataSource as never,
		new OrderCancellationService(transition),
	);
	const cancel = (payload: Record<string, unknown> = {}) =>
		handler.execute(
			new CancelOrderCommand({ orderId: ORDER, userId: USER, ...payload }),
		);
	return { cancel, manager, outbox };
}

const appended = (outbox: { append: jest.Mock }) =>
	(outbox.append.mock.calls as [unknown, any][]).map(([, input]) => input);

describe('CancelOrderHandler', () => {
	it('huỷ PAID: CANCELLED(USER), refundStatus PENDING, RefundPayment = total - ship, RestockInventory, OrderCancelled{paid:true}', async () => {
		const { cancel, manager, outbox } = setup(makeOrder());
		const result = await cancel();

		const [, where, set] = manager.update.mock.calls[0];
		expect(where).toEqual({ id: ORDER, version: 3 });
		expect(set).toMatchObject({
			status: OrderStatus.CANCELLED,
			cancelReason: 'USER',
			refundStatus: OrderRefundStatus.PENDING,
		});

		const items = appended(outbox);
		expect(items.map((i) => i.type)).toEqual([
			MESSAGE_TYPE.ORDER_STATUS_CHANGED,
			MESSAGE_TYPE.REFUND_PAYMENT,
			MESSAGE_TYPE.RESTOCK_INVENTORY,
			MESSAGE_TYPE.ORDER_CANCELLED,
		]);
		expect(items[1]).toMatchObject({
			topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
			orderId: ORDER,
			payload: { amount: 200000, reason: 'USER' },
		});
		expect(items[2]).toMatchObject({
			topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
			orderId: ORDER,
		});
		expect(items[3].payload).toMatchObject({ userId: USER, paid: true });
		expect(result).toEqual({
			orderId: ORDER,
			status: OrderStatus.CANCELLED,
			cancelReason: 'USER',
			refundStatus: OrderRefundStatus.PENDING,
			refundAmount: 200000,
		});
	});

	it('huỷ FULFILLING: như PAID kèm CancelShipment', async () => {
		const { cancel, outbox } = setup(
			makeOrder({ status: OrderStatus.FULFILLING }),
		);
		await cancel();

		const types = appended(outbox).map((i) => i.type);
		expect(types).toContain(MESSAGE_TYPE.REFUND_PAYMENT);
		expect(types).toContain(MESSAGE_TYPE.RESTOCK_INVENTORY);
		expect(types).toContain(MESSAGE_TYPE.CANCEL_SHIPMENT);
		const ship = appended(outbox).find(
			(i) => i.type === MESSAGE_TYPE.CANCEL_SHIPMENT,
		);
		expect(ship).toMatchObject({
			topic: KAFKA_TOPIC.SHIPPING_COMMANDS,
			orderId: ORDER,
		});
	});

	it('huỷ PAID không gửi CancelShipment', async () => {
		const { cancel, outbox } = setup(makeOrder());
		await cancel();
		expect(appended(outbox).map((i) => i.type)).not.toContain(
			MESSAGE_TYPE.CANCEL_SHIPMENT,
		);
	});

	it('huỷ PENDING_PAYMENT: ReleaseInventory + CancelPaymentIntent + OrderCancelled{paid:false}, không hoàn tiền', async () => {
		const { cancel, outbox } = setup(
			makeOrder({ status: OrderStatus.PENDING_PAYMENT }),
		);
		const result = await cancel();

		const items = appended(outbox);
		expect(items.map((i) => i.type)).toEqual([
			MESSAGE_TYPE.ORDER_STATUS_CHANGED,
			MESSAGE_TYPE.RELEASE_INVENTORY,
			MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
			MESSAGE_TYPE.ORDER_CANCELLED,
		]);
		expect(items[3].payload).toMatchObject({
			paid: false,
			cancelReason: 'USER',
		});
		expect(result.refundAmount).toBeNull();
		expect(result.refundStatus).toBe(OrderRefundStatus.NONE);
	});

	it.each([OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.REFUNDING])(
		'%s: 409, không đổi đơn, không outbox',
		async (status) => {
			const { cancel, manager, outbox } = setup(makeOrder({ status }));
			await expect(cancel()).rejects.toMatchObject({
				error: { statusCode: 409 },
			});
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		},
	);

	it.each([OrderStatus.CANCELLED, OrderStatus.COMPLETED, OrderStatus.REFUNDED])(
		'%s (terminal): 400',
		async (status) => {
			const { cancel, manager } = setup(makeOrder({ status }));
			await expect(cancel()).rejects.toMatchObject({
				error: { statusCode: 400 },
			});
			expect(manager.update).not.toHaveBeenCalled();
		},
	);

	it('đơn của user khác: 404 như không tồn tại', async () => {
		const { cancel, manager } = setup(makeOrder());
		await expect(cancel({ userId: OTHER })).rejects.toMatchObject({
			error: { statusCode: 404 },
		});
		expect(manager.update).not.toHaveBeenCalled();
	});

	it('đơn không tồn tại: 404', async () => {
		const { cancel } = setup(null);
		await expect(cancel()).rejects.toMatchObject({
			error: { statusCode: 404 },
		});
	});

	it('lệch version: 409 "đơn vừa thay đổi", không ghi outbox, không retry', async () => {
		const { cancel, manager, outbox } = setup(makeOrder(), 0);
		await expect(cancel()).rejects.toMatchObject({
			error: { statusCode: 409, message: 'Đơn vừa thay đổi, hãy tải lại' },
		});
		expect(manager.update).toHaveBeenCalledTimes(1);
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('payload sai (orderId không phải UUID): 400, không đọc DB', async () => {
		const { cancel, manager } = setup(makeOrder());
		await expect(cancel({ orderId: 'abc' })).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
		expect(manager.findOne).not.toHaveBeenCalled();
	});
});
