// Mock manager/provider trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { RefundPaymentHandler } from './refund-payment.handler';
import { RefundPaymentCommand } from '../refund-payment.command';
import { PaymentTransaction } from '../../entities/payment-transaction.entity';
import {
	PaymentRefund,
	PaymentRefundStatus,
} from '../../entities/payment-refund.entity';
import { PaymentProvider } from '../../providers/payment-provider.interface';

const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function setup(opts: {
	refund?: Partial<PaymentRefund> | null;
	transaction?: Partial<PaymentTransaction> | null;
	providerResult?: { success: boolean; failureReason?: string } | Error;
}) {
	const findOne = jest.fn((entity: unknown) => {
		if (entity === PaymentRefund) return Promise.resolve(opts.refund ?? null);
		return Promise.resolve(opts.transaction ?? null);
	});
	const insert = jest.fn().mockResolvedValue(undefined);
	const manager = { findOne, insert } as unknown as EntityManager;
	const refundFn = jest.fn(() => {
		const r = opts.providerResult ?? { success: true };
		return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
	});
	const append = jest.fn().mockResolvedValue('evt');
	const handler = new RefundPaymentHandler(
		{ refund: refundFn } as unknown as PaymentProvider,
		{ append } as unknown as OutboxWriter,
	);
	const run = (amount: number, reason = 'USER') =>
		handler.execute(
			new RefundPaymentCommand(manager, ORDER_ID, amount, reason),
		);
	return { run, manager, insert, refundFn, append };
}

// pg trả decimal dạng string
const PAID = {
	id: 'tx-1',
	orderId: ORDER_ID,
	amount: '230000.00',
} as unknown as Partial<PaymentTransaction>;

describe('RefundPaymentHandler', () => {
	it('hoàn đúng amount được chỉ định (không mặc định số đã thu): provider nhận amount, lưu SUCCEEDED, outbox PaymentRefunded', async () => {
		const { run, manager, insert, refundFn, append } = setup({
			transaction: PAID,
		});

		const { refundId } = await run(200000);

		expect(refundFn).toHaveBeenCalledWith(
			expect.objectContaining({
				orderId: ORDER_ID,
				transactionId: 'tx-1',
				amount: 200000,
			}),
		);
		const [entity, row] = insert.mock.calls[0];
		expect(entity).toBe(PaymentRefund);
		expect(row).toMatchObject({
			id: refundId,
			orderId: ORDER_ID,
			transactionId: 'tx-1',
			amount: 200000,
			status: PaymentRefundStatus.SUCCEEDED,
		});
		expect(append).toHaveBeenCalledWith(manager, {
			topic: KAFKA_TOPIC.PAYMENT_EVENTS,
			type: MESSAGE_TYPE.PAYMENT_REFUNDED,
			orderId: ORDER_ID,
			payload: { refundId, amount: 200000 },
		});
	});

	it('amount lớn hơn số đã thu: FAILED + PaymentRefundFailed, không gọi provider', async () => {
		const { run, insert, refundFn, append } = setup({ transaction: PAID });

		await run(230000.01);

		expect(refundFn).not.toHaveBeenCalled();
		expect(insert.mock.calls[0][1].status).toBe(PaymentRefundStatus.FAILED);
		expect(append.mock.calls[0][1].type).toBe(
			MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
		);
	});

	it('không có giao dịch thành công: FAILED + PaymentRefundFailed, transactionId null', async () => {
		const { run, insert, refundFn, append } = setup({ transaction: null });

		await run(1000);

		expect(refundFn).not.toHaveBeenCalled();
		expect(insert.mock.calls[0][1]).toMatchObject({
			transactionId: null,
			status: PaymentRefundStatus.FAILED,
		});
		expect(append.mock.calls[0][1].type).toBe(
			MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
		);
	});

	it.each([
		['trả success=false', { success: false, failureReason: 'bank down' }],
		['ném lỗi', new Error('bank down')],
	])(
		'provider %s: lưu FAILED + PaymentRefundFailed với lý do',
		async (_label, providerResult) => {
			const { run, insert, append } = setup({
				transaction: PAID,
				providerResult,
			});

			await run(1000);

			expect(insert.mock.calls[0][1]).toMatchObject({
				status: PaymentRefundStatus.FAILED,
				failureReason: 'bank down',
			});
			expect(append.mock.calls[0][1]).toMatchObject({
				type: MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
				payload: { reason: 'bank down' },
			});
		},
	);

	it('lần 2 với refund SUCCEEDED đã lưu: không gọi provider, không insert, phát lại PaymentRefunded', async () => {
		const { run, insert, refundFn, append } = setup({
			refund: {
				id: 'refund-1',
				orderId: ORDER_ID,
				amount: '200000.00' as unknown as number,
				status: PaymentRefundStatus.SUCCEEDED,
			},
			transaction: PAID,
		});

		const out = await run(150000);

		expect(out).toEqual({ refundId: 'refund-1' });
		expect(refundFn).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
		expect(append.mock.calls[0][1]).toMatchObject({
			type: MESSAGE_TYPE.PAYMENT_REFUNDED,
			payload: { refundId: 'refund-1', amount: 200000 },
		});
	});

	it('lần 2 với refund FAILED đã lưu: phát lại PaymentRefundFailed, không thử lại', async () => {
		const { run, refundFn, append } = setup({
			refund: {
				id: 'refund-1',
				orderId: ORDER_ID,
				amount: 1000,
				status: PaymentRefundStatus.FAILED,
				failureReason: 'bank down',
			},
		});

		await run(1000);

		expect(refundFn).not.toHaveBeenCalled();
		expect(append.mock.calls[0][1]).toMatchObject({
			type: MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
			payload: { reason: 'bank down' },
		});
	});

	it.each([0, -5, NaN])(
		'amount không hợp lệ (%s): 400, không ghi gì',
		async (amount) => {
			const { run, insert, append } = setup({ transaction: PAID });
			await expect(run(amount)).rejects.toMatchObject({
				error: { statusCode: 400 },
			});
			expect(insert).not.toHaveBeenCalled();
			expect(append).not.toHaveBeenCalled();
		},
	);
});
