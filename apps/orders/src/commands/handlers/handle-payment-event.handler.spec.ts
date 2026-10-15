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
import { HandlePaymentEventCommand } from '../handle-payment-event.command';
import { HandlePaymentEventHandler } from './handle-payment-event.handler';

// CartService kéo @lib/cached -> @nestjs/terminus (ESM-only) mà jest CJS không nạp được.
jest.mock('../../cart/cart.service', () => ({ CartService: class {} }));

const ORDER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function makeOrder(extra: Record<string, unknown> = {}): Order {
	return {
		id: ORDER,
		userId: USER,
		status: OrderStatus.PENDING_PAYMENT,
		version: 1,
		totalAmount: '230000.00',
		shippingFee: '30000.00',
		refundStatus: OrderRefundStatus.NONE,
		voucherCode: null,
		cancelReason: null,
		items: [
			{ productId: 'p-a', quantity: 2 },
			{ productId: 'p-b', quantity: 1 },
		],
		...extra,
	} as unknown as Order;
}

/** `orders` là chuỗi trạng thái đơn mà các lần findOne liên tiếp trả về; `updates` là kết quả từng UPDATE. */
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
	const cart = { deductItems: jest.fn().mockResolvedValue({}) };
	const handler = new HandlePaymentEventHandler(
		runner,
		transition,
		new OrderCancellationService(transition),
		outboxWriter,
		cart as never,
	);
	const send = (type: string, payload: unknown = {}, eventId?: string) =>
		handler.execute(
			new HandlePaymentEventCommand(
				createEnvelope({ type, orderId: ORDER, payload, eventId }),
				KAFKA_TOPIC.PAYMENT_EVENTS,
			),
		);
	return { send, manager, outbox, inbox, producer, cart };
}

const appended = (outbox: { append: jest.Mock }) =>
	(outbox.append.mock.calls as [unknown, any][]).map(([, input]) => input);
const typesOf = (outbox: { append: jest.Mock }) =>
	appended(outbox).map((i) => i.type);

describe('HandlePaymentEventHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	describe('PaymentSucceeded', () => {
		it('PENDING_PAYMENT -> PAID kèm paidAt; outbox OrderPaid + CommitInventory theo key orderId', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({ voucherCode: 'SALE10' }),
			]);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, {
				intentId: 'i-1',
				amount: 230000,
			});

			expect(manager.update).toHaveBeenCalledTimes(1);
			const [, where, set] = manager.update.mock.calls[0];
			expect(where).toEqual({ id: ORDER, version: 1 });
			expect(set.status).toBe(OrderStatus.PAID);
			expect(set.paidAt).toBeInstanceOf(Date);

			const items = appended(outbox);
			expect(items.map((i) => i.type)).toEqual([
				MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				MESSAGE_TYPE.ORDER_PAID,
				MESSAGE_TYPE.COMMIT_INVENTORY,
			]);
			expect(items[1]).toMatchObject({
				topic: KAFKA_TOPIC.ORDER_EVENTS,
				orderId: ORDER,
				payload: { userId: USER, voucherCode: 'SALE10' },
			});
			expect(items[2]).toMatchObject({
				topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
				orderId: ORDER,
				payload: {},
			});
		});

		it('OrderPaid không có voucherCode khi đơn không dùng voucher', async () => {
			const { send, outbox } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 });
			const paid = appended(outbox).find(
				(i) => i.type === MESSAGE_TYPE.ORDER_PAID,
			);
			expect(paid.payload).toEqual({ userId: USER });
		});

		it('sau commit trừ cart đúng các món của đơn', async () => {
			const { send, cart } = setup([makeOrder()]);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 });
			expect(cart.deductItems).toHaveBeenCalledWith(USER, [
				{ productId: 'p-a', quantity: 2 },
				{ productId: 'p-b', quantity: 1 },
			]);
		});

		it('lỗi trừ cart (Redis) không làm hỏng chuyển PAID: TX đã commit, không DLQ, không retry', async () => {
			const { send, cart, manager, producer, inbox } = setup([makeOrder()]);
			cart.deductItems.mockRejectedValue(new Error('redis down'));

			await expect(
				send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 }),
			).resolves.toBeUndefined();

			expect(manager.update).toHaveBeenCalledTimes(1);
			expect(inbox.tryAcquire).toHaveBeenCalledTimes(1);
			expect(producer.send).not.toHaveBeenCalled();
		});

		it('không trừ cart khi đơn không chuyển PAID', async () => {
			const { send, cart } = setup([
				makeOrder({ status: OrderStatus.CANCELLED }),
			]);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 });
			expect(cart.deductItems).not.toHaveBeenCalled();
		});

		it('đơn CANCELLED chưa hoàn: giữ status, refundStatus=PENDING, RefundPayment đúng số đã thu', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({
					status: OrderStatus.CANCELLED,
					cancelReason: 'PAYMENT_EXPIRED',
				}),
			]);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, {
				intentId: 'i-1',
				amount: 230000,
			});

			const [, where, set] = manager.update.mock.calls[0];
			expect(where).toEqual({ id: ORDER, version: 1 });
			expect(set.refundStatus).toBe(OrderRefundStatus.PENDING);
			expect(set.status).toBeUndefined();
			expect(appended(outbox)).toEqual([
				{
					topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
					type: MESSAGE_TYPE.REFUND_PAYMENT,
					orderId: ORDER,
					payload: { amount: 230000, reason: 'LATE_PAYMENT' },
				},
			]);
		});

		it('amount không hợp lệ ở nhánh thanh toán muộn: ném lỗi để retry/DLQ, không ghi outbox', async () => {
			const { send, outbox, producer } = setup([
				makeOrder({ status: OrderStatus.CANCELLED }),
			]);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 'abc' });
			expect(outbox.append).not.toHaveBeenCalled();
			expect(producer.send).toHaveBeenCalledWith(
				`${KAFKA_TOPIC.PAYMENT_EVENTS}.dlq`,
				ORDER,
				expect.anything(),
				expect.anything(),
			);
		});

		it.each([
			[OrderStatus.PAID, OrderRefundStatus.NONE],
			[OrderStatus.FULFILLING, OrderRefundStatus.NONE],
			[OrderStatus.CANCELLED, OrderRefundStatus.PENDING],
			[OrderStatus.CANCELLED, OrderRefundStatus.SUCCEEDED],
		])(
			'trùng/muộn khi đơn %s (refundStatus=%s): no-op',
			async (status, refundStatus) => {
				const { send, manager, outbox, cart } = setup([
					makeOrder({ status, refundStatus }),
				]);
				await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 });
				expect(manager.update).not.toHaveBeenCalled();
				expect(outbox.append).not.toHaveBeenCalled();
				expect(cart.deductItems).not.toHaveBeenCalled();
			},
		);

		it('đua với scheduler: lệch version lần 1, lần 2 đọc lại thấy CANCELLED nên hoàn tiền', async () => {
			const { send, manager, outbox, cart } = setup(
				[
					makeOrder({ version: 1 }),
					makeOrder({
						version: 2,
						status: OrderStatus.CANCELLED,
						cancelReason: 'PAYMENT_EXPIRED',
					}),
				],
				[0, 1],
			);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 });

			expect(manager.findOne).toHaveBeenCalledTimes(2);
			expect(manager.update).toHaveBeenCalledTimes(2);
			// Lần 1 lệch version nên không có outbox nào bị ghi từ lần đó (OutboxWriter chỉ sau UPDATE thành công).
			expect(typesOf(outbox)).toEqual([MESSAGE_TYPE.REFUND_PAYMENT]);
			expect(cart.deductItems).not.toHaveBeenCalled();
		});

		it('đua ngược lại: lệch version lần 1 rồi lần 2 vẫn PENDING_PAYMENT thì chuyển PAID', async () => {
			const { send, outbox } = setup(
				[makeOrder({ version: 1 }), makeOrder({ version: 2 })],
				[0, 1],
			);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 230000 });
			expect(typesOf(outbox)).toContain(MESSAGE_TYPE.ORDER_PAID);
		});

		it('đơn không tồn tại: log, không throw, không DLQ, inbox đã ghi', async () => {
			const { send, manager, producer, inbox } = setup([null]);
			await expect(
				send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 1 }),
			).resolves.toBeUndefined();
			expect(manager.update).not.toHaveBeenCalled();
			expect(inbox.tryAcquire).toHaveBeenCalledTimes(1);
			expect(producer.send).not.toHaveBeenCalled();
		});
	});

	describe('PaymentFailed', () => {
		it('PENDING_PAYMENT -> CANCELLED(PAYMENT_FAILED) + ReleaseInventory + CancelPaymentIntent + OrderCancelled{paid:false}', async () => {
			const { send, manager, outbox } = setup([
				makeOrder({ voucherCode: 'SALE10' }),
			]);
			await send(MESSAGE_TYPE.PAYMENT_FAILED, { reason: 'CARD_DECLINED' });

			const [, , set] = manager.update.mock.calls[0];
			expect(set.status).toBe(OrderStatus.CANCELLED);
			expect(set.cancelReason).toBe('PAYMENT_FAILED');
			const items = appended(outbox);
			expect(items.map((i) => i.type)).toEqual([
				MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				MESSAGE_TYPE.RELEASE_INVENTORY,
				MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
				MESSAGE_TYPE.ORDER_CANCELLED,
			]);
			expect(items[3].payload).toEqual({
				userId: USER,
				paid: false,
				cancelReason: 'PAYMENT_FAILED',
				voucherCode: 'SALE10',
			});
		});

		it.each([OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.FULFILLING])(
			'đơn %s: no-op',
			async (status) => {
				const { send, manager, outbox } = setup([makeOrder({ status })]);
				await send(MESSAGE_TYPE.PAYMENT_FAILED, { reason: 'x' });
				expect(manager.update).not.toHaveBeenCalled();
				expect(outbox.append).not.toHaveBeenCalled();
			},
		);

		it('lệch version lần 1: lần 2 đọc lại thấy đã CANCELLED thì no-op', async () => {
			const { send, manager, outbox } = setup(
				[makeOrder(), makeOrder({ status: OrderStatus.CANCELLED, version: 2 })],
				[0],
			);
			await send(MESSAGE_TYPE.PAYMENT_FAILED, { reason: 'x' });
			expect(manager.update).toHaveBeenCalledTimes(1);
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});

	describe('các message khác', () => {
		it.each([
			MESSAGE_TYPE.PAYMENT_REFUNDED,
			MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
		])('%s: chỉ ghi nhận (inbox đã đánh dấu), không đổi đơn', async (type) => {
			const { send, manager, outbox, inbox } = setup([makeOrder()]);
			await send(type, { refundId: 'r', amount: 1 });
			expect(inbox.tryAcquire).toHaveBeenCalledTimes(1);
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});

		it('type lạ: không throw, không đổi đơn', async () => {
			const { send, manager, producer } = setup([makeOrder()]);
			await expect(send('SomethingElse')).resolves.toBeUndefined();
			expect(manager.update).not.toHaveBeenCalled();
			expect(producer.send).not.toHaveBeenCalled();
		});

		it('eventId trùng (inbox từ chối): không đọc đơn, không đổi gì', async () => {
			const { send, manager, inbox, outbox } = setup([makeOrder()]);
			inbox.tryAcquire.mockResolvedValue(false);
			await send(MESSAGE_TYPE.PAYMENT_SUCCEEDED, { amount: 1 }, 'evt-1');
			expect(manager.findOne).not.toHaveBeenCalled();
			expect(manager.update).not.toHaveBeenCalled();
			expect(outbox.append).not.toHaveBeenCalled();
		});
	});
});
