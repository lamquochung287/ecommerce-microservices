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
import { HandleShippingEventCommand } from '../handle-shipping-event.command';
import { HandleShippingEventHandler } from './handle-shipping-event.handler';

const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function makeOrder(extra: Record<string, unknown> = {}): Order {
	return {
		id: ORDER,
		userId: USER,
		status: OrderStatus.FULFILLING,
		version: 5,
		totalAmount: '230000.00',
		shippingFee: '30000.00',
		refundStatus: OrderRefundStatus.NONE,
		voucherCode: 'SALE10',
		trackingCode: null,
		deliveredAt: null,
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
	const outboxWriter = outbox as unknown as OutboxWriter;
	const transition = new OrderTransitionService(outboxWriter);
	const handler = new HandleShippingEventHandler(
		runner,
		transition,
		new OrderCancellationService(transition),
		outboxWriter,
	);
	const send = (type: string, payload: unknown = {}) =>
		handler.execute(
			new HandleShippingEventCommand(
				createEnvelope({ type, orderId: ORDER, payload }),
				KAFKA_TOPIC.SHIPPING_EVENTS,
			),
		);
	return { send, manager, outbox, inbox, producer };
}

const appended = (outbox: { append: jest.Mock }) =>
	(outbox.append.mock.calls as [unknown, any][]).map(([, input]) => input);

describe('HandleShippingEventHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	describe('ShipmentCreated', () => {
		it('FULFILLING -> SHIPPED, lưu trackingCode, phát OrderStatusChanged', async () => {
			const { send, manager, outbox } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.SHIPMENT_CREATED, { trackingCode: 'TRK123' });

			const [, where, set] = manager.update.mock.calls[0];
			expect(where).toEqual({ id: ORDER, version: 5 });
			expect(set.status).toBe(OrderStatus.SHIPPED);
			expect(set.trackingCode).toBe('TRK123');
			const items = appended(outbox);
			expect(items).toHaveLength(1);
			expect(items[0]).toMatchObject({
				type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				payload: { previousStatus: 'FULFILLING', status: 'SHIPPED' },
			});
		});

		it('đơn CANCELLED (huỷ thắng): outbox CancelShipment, status giữ nguyên', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({ status: OrderStatus.CANCELLED }),
			]);
			await send(MESSAGE_TYPE.SHIPMENT_CREATED, { trackingCode: 'TRK123' });

			expect(manager.update).not.toHaveBeenCalled();
			expect(appended(outbox)).toEqual([
				{
					topic: KAFKA_TOPIC.SHIPPING_COMMANDS,
					type: MESSAGE_TYPE.CANCEL_SHIPMENT,
					orderId: ORDER,
					payload: {},
				},
			]);
		});

		it('lệch version lần 1 (huỷ vừa commit): retry đọc CANCELLED rồi CancelShipment', async () => {
			const { send, manager, outbox } = setup(
				[makeOrder(), makeOrder({ status: OrderStatus.CANCELLED, version: 6 })],
				[0],
			);
			await send(MESSAGE_TYPE.SHIPMENT_CREATED, { trackingCode: 'TRK123' });

			expect(manager.findOne).toHaveBeenCalledTimes(2);
			expect(manager.update).toHaveBeenCalledTimes(1);
			expect(appended(outbox).map((i) => i.type)).toEqual([
				MESSAGE_TYPE.CANCEL_SHIPMENT,
			]);
		});

		it.each([OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.PAID])(
			'đơn %s: no-op',
			async (status) => {
				const { send, manager, outbox } = setup([makeOrder({ status })]);
				await send(MESSAGE_TYPE.SHIPMENT_CREATED, { trackingCode: 'TRK123' });
				expect(manager.update).not.toHaveBeenCalled();
				expect(outbox.append).not.toHaveBeenCalled();
			},
		);

		it('thiếu trackingCode: ném lỗi (không SHIPPED thiếu mã), không đổi đơn', async () => {
			const { send, manager, outbox, producer } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.SHIPMENT_CREATED, {});
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
			// Hết lượt retry thì runner đưa message vào DLQ.
			expect(producer.send).toHaveBeenCalled();
		});
	});

	describe('ShipmentDelivered', () => {
		it('SHIPPED -> DELIVERED với deliveredAt theo payload', async () => {
			const { send, manager } = setup([
				makeOrder({ status: OrderStatus.SHIPPED }),
			]);
			const at = '2026-10-15T10:00:00.000Z';
			await send(MESSAGE_TYPE.SHIPMENT_DELIVERED, { deliveredAt: at });

			const [, , set] = manager.update.mock.calls[0];
			expect(set.status).toBe(OrderStatus.DELIVERED);
			expect(set.deliveredAt).toEqual(new Date(at));
		});

		it.each([
			OrderStatus.FULFILLING,
			OrderStatus.DELIVERED,
			OrderStatus.CANCELLED,
		])('đơn %s (lệch thứ tự): no-op', async (status) => {
			const { send, manager, outbox } = setup([makeOrder({ status })]);
			await send(MESSAGE_TYPE.SHIPMENT_DELIVERED, {
				deliveredAt: '2026-10-15T10:00:00.000Z',
			});
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});

		it('deliveredAt không hợp lệ: không đổi đơn', async () => {
			const { send, manager } = setup([
				makeOrder({ status: OrderStatus.SHIPPED }),
			]);
			await send(MESSAGE_TYPE.SHIPMENT_DELIVERED, { deliveredAt: 'abc' });
			expect(manager.update).not.toHaveBeenCalled();
		});
	});

	describe('ShipmentFailed', () => {
		it('FULFILLING -> CANCELLED(SHIPMENT_FAILED), RefundPayment = total - ship, RestockInventory, refundStatus PENDING', async () => {
			const { send, manager, outbox } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.SHIPMENT_FAILED, { reason: 'CARRIER_DOWN' });

			const [, , set] = manager.update.mock.calls[0];
			expect(set.status).toBe(OrderStatus.CANCELLED);
			expect(set.cancelReason).toBe('SHIPMENT_FAILED');
			expect(set.refundStatus).toBe(OrderRefundStatus.PENDING);

			const items = appended(outbox);
			expect(items.map((i) => i.type)).toEqual([
				MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				MESSAGE_TYPE.REFUND_PAYMENT,
				MESSAGE_TYPE.RESTOCK_INVENTORY,
				MESSAGE_TYPE.ORDER_CANCELLED,
			]);
			expect(items[1]).toMatchObject({
				topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
				payload: { amount: 200000, reason: 'SHIPMENT_FAILED' },
			});
			expect(items[3].payload).toMatchObject({
				userId: USER,
				paid: true,
				cancelReason: 'SHIPMENT_FAILED',
			});
			// Không huỷ vận đơn (chưa tạo được) và không trả kho chưa commit.
			expect(items.map((i) => i.type)).not.toContain(
				MESSAGE_TYPE.CANCEL_SHIPMENT,
			);
		});

		it('đơn CANCELLED: no-op, không hoàn tiền lần hai', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({ status: OrderStatus.CANCELLED }),
			]);
			await send(MESSAGE_TYPE.SHIPMENT_FAILED, { reason: 'x' });
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});

		it('đơn SHIPPED (không hợp lệ): no-op', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({ status: OrderStatus.SHIPPED }),
			]);
			await send(MESSAGE_TYPE.SHIPMENT_FAILED, { reason: 'x' });
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});

	describe('chung', () => {
		it('đơn không tồn tại: không throw, không DLQ, inbox đã ghi', async () => {
			const { send, producer, inbox } = setup([null]);
			await expect(
				send(MESSAGE_TYPE.SHIPMENT_CREATED, { trackingCode: 'T' }),
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
			await send(MESSAGE_TYPE.SHIPMENT_CREATED, { trackingCode: 'T' });
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});
});
