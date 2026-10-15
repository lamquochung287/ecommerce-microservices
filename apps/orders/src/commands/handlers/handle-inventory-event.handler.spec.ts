// Mock jest.fn() và raw params có kiểu any/unknown theo thiết kế.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	KafkaConsumerRunner,
	KafkaProducerService,
	OutboxWriter,
	createEnvelope,
} from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import {
	Order,
	OrderRefundStatus,
	OrderStatus,
} from '../../entities/order.entity';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { HandleInventoryEventCommand } from '../handle-inventory-event.command';
import { HandleInventoryEventHandler } from './handle-inventory-event.handler';

const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function makeOrder(extra: Record<string, unknown> = {}): Order {
	return {
		id: ORDER,
		userId: USER,
		status: OrderStatus.PAID,
		version: 3,
		totalAmount: '230000.00',
		shippingFee: '30000.00',
		refundStatus: OrderRefundStatus.NONE,
		voucherCode: 'SALE10',
		recipientName: 'Nguyen Van A',
		recipientPhone: '0900000000',
		addressLine1: '1 Le Loi',
		addressLine2: null,
		city: 'HCM',
		province: null,
		postalCode: '700000',
		country: 'VN',
		items: [
			{ productId: 'p-a', quantity: 2 },
			{ productId: 'p-b', quantity: 1 },
		],
		...extra,
	} as unknown as Order;
}

function setup(orders: Array<Order | null>, updates: number[] = [1]) {
	const findOne = jest.fn();
	for (const o of orders) findOne.mockResolvedValueOnce(o);
	findOne.mockResolvedValue(orders[orders.length - 1] ?? null);
	const update = jest.fn();
	for (const affected of updates) update.mockResolvedValueOnce({ affected });
	update.mockResolvedValue({ affected: 1 });
	const manager = { findOne, update };
	const dataSource = {
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const inbox = { tryAcquire: jest.fn().mockResolvedValue(true) };
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const config = {
		get: (key: string, fallback: number) =>
			key === 'KAFKA_CONSUMER_RETRY_BACKOFF_MS' ? 0 : fallback,
	} as unknown as ConfigService;
	const runner = new KafkaConsumerRunner(
		dataSource as never,
		inbox,
		producer as unknown as KafkaProducerService,
		config,
	);
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const transition = new OrderTransitionService(
		outbox as unknown as OutboxWriter,
	);
	const handler = new HandleInventoryEventHandler(
		runner,
		transition,
		new OrderCancellationService(transition),
	);
	const send = (type: string, payload: unknown = {}) =>
		handler.execute(
			new HandleInventoryEventCommand(
				createEnvelope({ type, orderId: ORDER, payload }),
				KAFKA_TOPIC.INVENTORY_EVENTS,
			),
		);
	return { send, manager, outbox, inbox, producer };
}

const appended = (outbox: { append: jest.Mock }) =>
	(outbox.append.mock.calls as [unknown, any][]).map(([, input]) => input);

describe('HandleInventoryEventHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	describe('InventoryCommitted', () => {
		it('PAID -> FULFILLING + CreateShipment có địa chỉ và items (không có field rỗng)', async () => {
			const { send, manager, outbox } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.INVENTORY_COMMITTED);

			const [, where, set] = manager.update.mock.calls[0];
			expect(where).toEqual({ id: ORDER, version: 3 });
			expect(set.status).toBe(OrderStatus.FULFILLING);

			const items = appended(outbox);
			expect(items.map((i) => i.type)).toEqual([
				MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				MESSAGE_TYPE.CREATE_SHIPMENT,
			]);
			expect(items[1]).toEqual({
				topic: KAFKA_TOPIC.SHIPPING_COMMANDS,
				type: MESSAGE_TYPE.CREATE_SHIPMENT,
				orderId: ORDER,
				payload: {
					recipient: {
						recipientName: 'Nguyen Van A',
						recipientPhone: '0900000000',
						addressLine1: '1 Le Loi',
						city: 'HCM',
						postalCode: '700000',
						country: 'VN',
					},
					items: [
						{ productId: 'p-a', quantity: 2 },
						{ productId: 'p-b', quantity: 1 },
					],
				},
			});
		});

		it('đơn CANCELLED (huỷ khi đang PAID): bỏ qua, không CreateShipment, không đổi đơn', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({ status: OrderStatus.CANCELLED }),
			]);
			await send(MESSAGE_TYPE.INVENTORY_COMMITTED);
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});

		it.each([
			OrderStatus.FULFILLING,
			OrderStatus.SHIPPED,
			OrderStatus.PENDING_PAYMENT,
		])('trùng/lạc trạng thái %s: no-op', async (status) => {
			const { send, manager, outbox } = setup([makeOrder({ status })]);
			await send(MESSAGE_TYPE.INVENTORY_COMMITTED);
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});

		it('đua với user huỷ: lệch version lần 1, lần 2 đọc lại thấy CANCELLED nên không tạo vận đơn', async () => {
			const { send, manager, outbox } = setup(
				[makeOrder(), makeOrder({ status: OrderStatus.CANCELLED, version: 4 })],
				[0],
			);
			await send(MESSAGE_TYPE.INVENTORY_COMMITTED);
			expect(manager.findOne).toHaveBeenCalledTimes(2);
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});

	describe('InventoryCommitFailed', () => {
		it('PAID -> CANCELLED(INVENTORY_COMMIT_FAILED), RefundPayment = total - ship, OrderCancelled{paid:true}, không release voucher', async () => {
			const { send, manager, outbox } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.INVENTORY_COMMIT_FAILED, {
				reason: 'RESERVATION_EXPIRED',
			});

			const [, , set] = manager.update.mock.calls[0];
			expect(set.status).toBe(OrderStatus.CANCELLED);
			expect(set.cancelReason).toBe('INVENTORY_COMMIT_FAILED');
			expect(set.refundStatus).toBe(OrderRefundStatus.PENDING);

			const items = appended(outbox);
			expect(items.map((i) => i.type)).toEqual([
				MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				MESSAGE_TYPE.REFUND_PAYMENT,
				MESSAGE_TYPE.ORDER_CANCELLED,
			]);
			expect(items[1]).toMatchObject({
				topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
				orderId: ORDER,
				payload: { amount: 200000, reason: 'INVENTORY_COMMIT_FAILED' },
			});
			expect(items[2].payload).toMatchObject({
				userId: USER,
				paid: true,
				cancelReason: 'INVENTORY_COMMIT_FAILED',
			});
			// Kho không commit được nên không nhập lại; chưa có vận đơn nên không huỷ vận đơn.
			const types = items.map((i) => i.type);
			expect(types).not.toContain(MESSAGE_TYPE.RESTOCK_INVENTORY);
			expect(types).not.toContain(MESSAGE_TYPE.CANCEL_SHIPMENT);
			expect(types).not.toContain(MESSAGE_TYPE.RELEASE_INVENTORY);
		});

		it.each([
			OrderStatus.CANCELLED,
			OrderStatus.FULFILLING,
			OrderStatus.PENDING_PAYMENT,
		])('đơn %s: no-op', async (status) => {
			const { send, manager, outbox } = setup([makeOrder({ status })]);
			await send(MESSAGE_TYPE.INVENTORY_COMMIT_FAILED, { reason: 'x' });
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});

	describe('chung', () => {
		it('đơn không tồn tại: log, không throw, không DLQ, inbox đã ghi', async () => {
			const { send, producer, inbox } = setup([null]);
			await expect(
				send(MESSAGE_TYPE.INVENTORY_COMMITTED),
			).resolves.toBeUndefined();
			expect(inbox.tryAcquire).toHaveBeenCalledTimes(1);
			expect(producer.send).not.toHaveBeenCalled();
		});

		it('type lạ: không throw, không đổi đơn', async () => {
			const { send, manager } = setup([makeOrder()]);
			await expect(send('SomethingElse')).resolves.toBeUndefined();
			expect(manager.update).not.toHaveBeenCalled();
		});

		it('eventId trùng (inbox từ chối): không đổi gì', async () => {
			const { send, manager, inbox, outbox } = setup([makeOrder()]);
			inbox.tryAcquire.mockResolvedValue(false);
			await send(MESSAGE_TYPE.INVENTORY_COMMITTED);
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});
});
