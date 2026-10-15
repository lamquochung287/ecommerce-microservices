// Mock manager/outbox trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { HandlePaymentWebhookHandler } from './handle-payment-webhook.handler';
import { HandlePaymentWebhookCommand } from '../handle-payment-webhook.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';
import { SimulatedPaymentProvider } from '../../providers/simulated-payment.provider';

const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

const provider = new SimulatedPaymentProvider({
	get: (_k: string, fallback?: string) => fallback,
	getOrThrow: () => 'test-secret',
} as unknown as ConfigService);

function intent(status: PaymentTransactionStatus) {
	return {
		id: INTENT_ID,
		orderId: ORDER_ID,
		amount: '230000.00',
		status,
	} as unknown as PaymentTransaction;
}

function setup(opts: {
	intent?: PaymentTransaction | null;
	logInserted?: boolean;
}) {
	const query = jest
		.fn()
		.mockResolvedValue(opts.logInserted === false ? [] : [{ id: 'log-1' }]);
	const findOne = jest.fn().mockResolvedValue(opts.intent ?? null);
	const update = jest.fn().mockResolvedValue({ affected: 1 });
	const manager = { query, findOne, update } as unknown as EntityManager;
	const dataSource = {
		transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
			cb(manager),
		),
	} as unknown as DataSource;
	const append = jest.fn().mockResolvedValue('evt');
	const handler = new HandlePaymentWebhookHandler(dataSource, provider, {
		append,
	} as unknown as OutboxWriter);
	return { handler, manager, dataSource, query, findOne, update, append };
}

const webhook = (result: 'success' | 'fail') =>
	provider.buildWebhook(
		{ id: INTENT_ID, orderId: ORDER_ID, amount: 230000 },
		result,
	);

describe('HandlePaymentWebhookHandler', () => {
	it('chữ ký sai: 400, không mở transaction, không ghi gì', async () => {
		const { handler, dataSource, append } = setup({
			intent: intent(PaymentTransactionStatus.PENDING),
		});
		const { payload } = webhook('success');

		await expect(
			handler.execute(
				new HandlePaymentWebhookCommand({ payload, signature: 'deadbeef' }),
			),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
		expect(dataSource.transaction).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it('chữ ký khác độ dài: 400', async () => {
		const { handler, dataSource } = setup({});
		const { payload, signature } = webhook('success');
		await expect(
			handler.execute(
				new HandlePaymentWebhookCommand({
					payload,
					signature: signature + '00',
				}),
			),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
		expect(dataSource.transaction).not.toHaveBeenCalled();
	});

	it('payload sai hình dạng dù chữ ký đúng: 400', async () => {
		const { handler } = setup({});
		const payload = { eventId: 'e', intentId: 'not-a-uuid', orderId: ORDER_ID };
		await expect(
			handler.execute(
				new HandlePaymentWebhookCommand({
					payload,
					signature: provider.signWebhook(payload),
				}),
			),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
	});

	it('trùng eventId: alreadyProcessed, không khoá intent, không outbox', async () => {
		const { handler, findOne, append, update } = setup({ logInserted: false });

		const result = await handler.execute(
			new HandlePaymentWebhookCommand(webhook('success')),
		);

		expect(result).toEqual({ processed: false, alreadyProcessed: true });
		expect(findOne).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});

	it('SUCCEEDED + intent PENDING: SUCCEEDED, paidAt, outbox PaymentSucceeded cùng manager, khoá FOR UPDATE', async () => {
		const { handler, manager, findOne, update, append, query } = setup({
			intent: intent(PaymentTransactionStatus.PENDING),
		});

		const result = await handler.execute(
			new HandlePaymentWebhookCommand(webhook('success')),
		);

		expect(result).toEqual({ processed: true, alreadyProcessed: false });
		expect(query.mock.calls[0][0]).toContain(
			'ON CONFLICT ("eventId") DO NOTHING',
		);
		expect(findOne.mock.calls[0][1].lock).toEqual({
			mode: 'pessimistic_write',
		});
		const [entity, id, patch] = update.mock.calls[0];
		expect(entity).toBe(PaymentTransaction);
		expect(id).toBe(INTENT_ID);
		expect(patch.status).toBe(PaymentTransactionStatus.SUCCEEDED);
		expect(patch.paidAt).toBeInstanceOf(Date);
		expect(append).toHaveBeenCalledTimes(1);
		expect(append).toHaveBeenCalledWith(manager, {
			topic: KAFKA_TOPIC.PAYMENT_EVENTS,
			type: MESSAGE_TYPE.PAYMENT_SUCCEEDED,
			orderId: ORDER_ID,
			payload: { intentId: INTENT_ID, amount: 230000 },
		});
	});

	it('SUCCEEDED + intent CANCELLED (trả muộn): vẫn SUCCEEDED + PaymentSucceeded', async () => {
		const { handler, update, append } = setup({
			intent: intent(PaymentTransactionStatus.CANCELLED),
		});

		await handler.execute(new HandlePaymentWebhookCommand(webhook('success')));

		expect(update.mock.calls[0][2].status).toBe(
			PaymentTransactionStatus.SUCCEEDED,
		);
		expect(append.mock.calls[0][1].type).toBe(MESSAGE_TYPE.PAYMENT_SUCCEEDED);
	});

	it('FAILED + intent PENDING: FAILED + outbox PaymentFailed', async () => {
		const { handler, update, append } = setup({
			intent: intent(PaymentTransactionStatus.PENDING),
		});

		await handler.execute(new HandlePaymentWebhookCommand(webhook('fail')));

		expect(update.mock.calls[0][2].status).toBe(
			PaymentTransactionStatus.FAILED,
		);
		expect(append.mock.calls[0][1]).toMatchObject({
			type: MESSAGE_TYPE.PAYMENT_FAILED,
			orderId: ORDER_ID,
		});
	});

	it.each([
		[PaymentTransactionStatus.SUCCEEDED, 'success'],
		[PaymentTransactionStatus.SUCCEEDED, 'fail'],
		[PaymentTransactionStatus.FAILED, 'success'],
		[PaymentTransactionStatus.FAILED, 'fail'],
		[PaymentTransactionStatus.CANCELLED, 'fail'],
	] as const)(
		'intent đã %s nhận webhook %s: no-op, không outbox',
		async (status, result) => {
			// SUCCEEDED/FAILED là trạng thái cuối (intent FAILED không được hồi sinh); CANCELLED chỉ nhận SUCCEEDED.
			const { handler, update, append } = setup({ intent: intent(status) });

			const out = await handler.execute(
				new HandlePaymentWebhookCommand(webhook(result)),
			);

			expect(out).toEqual({ processed: true, alreadyProcessed: false });
			expect(update).not.toHaveBeenCalled();
			expect(append).not.toHaveBeenCalled();
		},
	);

	it('intent không tồn tại: 404 (transaction rollback, log không được giữ)', async () => {
		const { handler } = setup({ intent: null });
		await expect(
			handler.execute(new HandlePaymentWebhookCommand(webhook('success'))),
		).rejects.toMatchObject({ error: { statusCode: 404 } });
	});

	it('amount lệch với intent: 400, không đổi state', async () => {
		const { handler, update, append } = setup({
			intent: {
				...intent(PaymentTransactionStatus.PENDING),
				amount: 999 as unknown as number,
			},
		});
		await expect(
			handler.execute(new HandlePaymentWebhookCommand(webhook('success'))),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
		expect(update).not.toHaveBeenCalled();
		expect(append).not.toHaveBeenCalled();
	});
});
