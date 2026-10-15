// Raw query trả any theo thiết kế của TypeORM.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { HandlePaymentWebhookHandler } from '../src/commands/handlers/handle-payment-webhook.handler';
import { HandlePaymentWebhookCommand } from '../src/commands/handle-payment-webhook.command';
import { RefundPaymentHandler } from '../src/commands/handlers/refund-payment.handler';
import { RefundPaymentCommand } from '../src/commands/refund-payment.command';
import { CancelPaymentIntentHandler } from '../src/commands/handlers/cancel-payment-intent.handler';
import { CancelPaymentIntentCommand } from '../src/commands/cancel-payment-intent.command';
import { SimulatedPaymentProvider } from '../src/providers/simulated-payment.provider';

const SOURCE = `int-${randomUUID()}`;
const provider = new SimulatedPaymentProvider({
	get: (_k: string, fallback?: string) => fallback,
	getOrThrow: () => 'int-secret',
} as unknown as ConfigService);

async function insertIntent(
	ds: DataSource,
	status: 'PENDING' | 'CANCELLED' | 'SUCCEEDED',
	amount = 230000,
): Promise<{ intentId: string; orderId: string }> {
	const intentId = randomUUID();
	const orderId = randomUUID();
	await ds.query(
		`INSERT INTO payment_transactions (id, "orderId", "idempotencyKey", amount, status, "expiresAt", "checkoutUrl")
		 VALUES ($1, $2, $2, $3, $4, now() + interval '15 minutes', 'http://x')`,
		[intentId, orderId, amount, status],
	);
	return { intentId, orderId };
}

const outboxRows = (ds: DataSource, orderId: string) =>
	ds.query(
		`SELECT "eventType", payload FROM outbox WHERE key = $1 AND source = $2 ORDER BY "createdAt"`,
		[orderId, SOURCE],
	);

describeWithDb('Payment webhook, refund, cancel (postgres)', ({ it }) => {
	const webhookHandler = (ds: DataSource) =>
		new HandlePaymentWebhookHandler(
			ds,
			provider,
			new OutboxWriter({ source: SOURCE }),
		);

	it('webhook thành công gửi hai lần song song: chỉ một PaymentSucceeded, intent SUCCEEDED', async (ds) => {
		const { intentId, orderId } = await insertIntent(ds, 'PENDING');
		const wh = provider.buildWebhook(
			{ id: intentId, orderId, amount: 230000 },
			'success',
		);
		const handler = webhookHandler(ds);

		const results = await Promise.all([
			handler.execute(new HandlePaymentWebhookCommand(wh)),
			handler.execute(new HandlePaymentWebhookCommand(wh)),
		]);

		expect(results.filter((r) => r.alreadyProcessed)).toHaveLength(1);
		const rows = await outboxRows(ds, orderId);
		expect(rows).toHaveLength(1);
		expect(rows[0].eventType).toBe('PaymentSucceeded');
		const [tx] = await ds.query(
			`SELECT status, "paidAt" FROM payment_transactions WHERE id = $1`,
			[intentId],
		);
		expect(tx.status).toBe('SUCCEEDED');
		expect(tx.paidAt).not.toBeNull();
	});

	it('webhook tới intent CANCELLED: vẫn SUCCEEDED + PaymentSucceeded', async (ds) => {
		const { intentId, orderId } = await insertIntent(ds, 'CANCELLED');
		await webhookHandler(ds).execute(
			new HandlePaymentWebhookCommand(
				provider.buildWebhook(
					{ id: intentId, orderId, amount: 230000 },
					'success',
				),
			),
		);
		const [tx] = await ds.query(
			`SELECT status FROM payment_transactions WHERE id = $1`,
			[intentId],
		);
		expect(tx.status).toBe('SUCCEEDED');
		expect((await outboxRows(ds, orderId))[0].eventType).toBe(
			'PaymentSucceeded',
		);
	});

	it('CancelPaymentIntent chỉ đổi PENDING; intent SUCCEEDED giữ nguyên', async (ds) => {
		const pending = await insertIntent(ds, 'PENDING');
		const paid = await insertIntent(ds, 'SUCCEEDED');
		const handler = new CancelPaymentIntentHandler();

		await ds.transaction(async (m) => {
			await handler.execute(new CancelPaymentIntentCommand(m, pending.orderId));
			await handler.execute(new CancelPaymentIntentCommand(m, paid.orderId));
		});

		const rows = await ds.query(
			`SELECT id, status FROM payment_transactions WHERE id = ANY($1)`,
			[[pending.intentId, paid.intentId]],
		);
		const byId = Object.fromEntries(rows.map((r: any) => [r.id, r.status]));
		expect(byId[pending.intentId]).toBe('CANCELLED');
		expect(byId[paid.intentId]).toBe('SUCCEEDED');
	});

	it('RefundPayment hai lần cho cùng đơn: một dòng payment_refunds, provider chỉ gọi một lần, kết quả được phát lại', async (ds) => {
		const { orderId } = await insertIntent(ds, 'SUCCEEDED', 230000);
		const refundSpy = jest.spyOn(provider, 'refund');
		const handler = new RefundPaymentHandler(
			provider,
			new OutboxWriter({ source: SOURCE }),
		);

		const first = await ds.transaction((m) =>
			handler.execute(new RefundPaymentCommand(m, orderId, 200000, 'USER')),
		);
		const second = await ds.transaction((m) =>
			handler.execute(new RefundPaymentCommand(m, orderId, 200000, 'USER')),
		);

		expect(second.refundId).toBe(first.refundId);
		expect(refundSpy).toHaveBeenCalledTimes(1);
		const refunds = await ds.query(
			`SELECT amount, status FROM payment_refunds WHERE "orderId" = $1`,
			[orderId],
		);
		expect(refunds).toHaveLength(1);
		expect(Number(refunds[0].amount)).toBe(200000);
		expect(refunds[0].status).toBe('SUCCEEDED');
		const events = await outboxRows(ds, orderId);
		expect(events.map((e: any) => e.eventType)).toEqual([
			'PaymentRefunded',
			'PaymentRefunded',
		]);
		refundSpy.mockRestore();
	});
});
