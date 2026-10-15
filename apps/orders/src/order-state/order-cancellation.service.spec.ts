/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { EntityManager } from 'typeorm';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderCancelReason } from './order-cancel-reason.enum';
import { OrderCancellationService } from './order-cancellation.service';
import { OrderTransitionService } from './order-transition.service';

function setup() {
	const transition = jest.fn().mockResolvedValue({ id: 'o-1' });
	const service = new OrderCancellationService({
		transition,
	} as unknown as OrderTransitionService);
	return { service, transition };
}

const manager = {} as EntityManager;
const order = (extra: Partial<Order> = {}) =>
	({
		id: 'o-1',
		userId: 'u-1',
		status: OrderStatus.PENDING_PAYMENT,
		version: 1,
		voucherCode: null,
		...extra,
	}) as Order;

describe('OrderCancellationService.cancelUnpaid', () => {
	it('releaseInventory=true: ReleaseInventory + CancelPaymentIntent + OrderCancelled{paid:false}', async () => {
		const { service, transition } = setup();
		await service.cancelUnpaid(
			manager,
			order({ voucherCode: 'SALE10' }),
			OrderCancelReason.PAYMENT_EXPIRED,
			{ releaseInventory: true },
		);

		const input = transition.mock.calls[0][1];
		expect(transition.mock.calls[0][0]).toBe(manager);
		expect(input.to).toBe(OrderStatus.CANCELLED);
		expect(input.patch).toEqual({ cancelReason: 'PAYMENT_EXPIRED' });
		expect(input.messages).toEqual([
			{
				topic: KAFKA_TOPIC.INVENTORY_COMMANDS,
				type: MESSAGE_TYPE.RELEASE_INVENTORY,
				payload: {},
			},
			{
				topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
				type: MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
				payload: {},
			},
			{
				topic: KAFKA_TOPIC.ORDER_EVENTS,
				type: MESSAGE_TYPE.ORDER_CANCELLED,
				payload: {
					userId: 'u-1',
					paid: false,
					cancelReason: 'PAYMENT_EXPIRED',
					voucherCode: 'SALE10',
				},
			},
		]);
	});

	it('releaseInventory=false: không có ReleaseInventory; không voucher thì payload không có voucherCode', async () => {
		const { service, transition } = setup();
		await service.cancelUnpaid(manager, order(), OrderCancelReason.REPLACED, {
			releaseInventory: false,
		});

		const types = transition.mock.calls[0][1].messages.map(
			(m: { type: string }) => m.type,
		);
		expect(types).toEqual([
			MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
			MESSAGE_TYPE.ORDER_CANCELLED,
		]);
		expect(transition.mock.calls[0][1].messages[1].payload).toEqual({
			userId: 'u-1',
			paid: false,
			cancelReason: 'REPLACED',
		});
	});

	it('lỗi lệch version từ transition được truyền ra ngoài', async () => {
		const { service, transition } = setup();
		const conflict = new Error('conflict');
		transition.mockRejectedValue(conflict);
		await expect(
			service.cancelUnpaid(manager, order(), OrderCancelReason.REPLACED, {
				releaseInventory: false,
			}),
		).rejects.toBe(conflict);
	});
});

describe('OrderCancellationService.cancelPaid', () => {
	const paidOrder = (extra: Partial<Order> = {}) =>
		order({
			status: OrderStatus.PAID,
			totalAmount: '230000.00' as unknown as number,
			shippingFee: '30000.00' as unknown as number,
			...extra,
		});

	it('restock=false: RefundPayment = total - ship + OrderCancelled{paid:true}, refundStatus PENDING', async () => {
		const { service, transition } = setup();
		await service.cancelPaid(
			manager,
			paidOrder({ voucherCode: 'SALE10' }),
			OrderCancelReason.INVENTORY_COMMIT_FAILED,
			{ restock: false },
		);

		const input = transition.mock.calls[0][1];
		expect(input.to).toBe(OrderStatus.CANCELLED);
		expect(input.patch).toEqual({
			cancelReason: 'INVENTORY_COMMIT_FAILED',
			refundStatus: 'PENDING',
		});
		expect(input.messages).toEqual([
			{
				topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
				type: MESSAGE_TYPE.REFUND_PAYMENT,
				payload: { amount: 200000, reason: 'INVENTORY_COMMIT_FAILED' },
			},
			{
				topic: KAFKA_TOPIC.ORDER_EVENTS,
				type: MESSAGE_TYPE.ORDER_CANCELLED,
				payload: {
					userId: 'u-1',
					paid: true,
					cancelReason: 'INVENTORY_COMMIT_FAILED',
					voucherCode: 'SALE10',
				},
			},
		]);
	});

	it('restock + cancelShipment: thêm RestockInventory và CancelShipment trước OrderCancelled', async () => {
		const { service, transition } = setup();
		await service.cancelPaid(manager, paidOrder(), OrderCancelReason.USER, {
			restock: true,
			cancelShipment: true,
		});

		const messages = transition.mock.calls[0][1].messages;
		expect(
			messages.map((m: { type: string; topic: string }) => [m.topic, m.type]),
		).toEqual([
			[KAFKA_TOPIC.PAYMENT_COMMANDS, MESSAGE_TYPE.REFUND_PAYMENT],
			[KAFKA_TOPIC.INVENTORY_COMMANDS, MESSAGE_TYPE.RESTOCK_INVENTORY],
			[KAFKA_TOPIC.SHIPPING_COMMANDS, MESSAGE_TYPE.CANCEL_SHIPMENT],
			[KAFKA_TOPIC.ORDER_EVENTS, MESSAGE_TYPE.ORDER_CANCELLED],
		]);
		expect(messages[3].payload).toEqual({
			userId: 'u-1',
			paid: true,
			cancelReason: 'USER',
		});
	});

	it('lỗi lệch version từ transition được truyền ra ngoài', async () => {
		const { service, transition } = setup();
		const conflict = new Error('conflict');
		transition.mockRejectedValue(conflict);
		await expect(
			service.cancelPaid(manager, paidOrder(), OrderCancelReason.USER, {
				restock: true,
			}),
		).rejects.toBe(conflict);
	});
});
