// Raw query trả any theo thiết kế của TypeORM; mock service trả any theo jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
// CartService kéo @lib/cached -> @nestjs/terminus (ESM-only) mà jest CJS không nạp được; spec chỉ cần token DI.
jest.mock('../src/cart/cart.service', () => ({
	CartService: class CartService {},
}));

import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { CheckoutCommand } from '../src/commands/checkout.command';
import { CheckoutHandler } from '../src/commands/handlers/checkout.handler';
import { OrderCancellationService } from '../src/order-state/order-cancellation.service';
import { OrderTransitionService } from '../src/order-state/order-transition.service';

const SOURCE = `int-${randomUUID()}`;
const address = {
	recipientName: 'An',
	recipientPhone: '0900000000',
	addressLine1: '1 Le Loi',
	city: 'HCM',
	country: 'VN',
};

function buildHandler(ds: DataSource, userId: string, productIds: string[]) {
	const outbox = new OutboxWriter({ source: SOURCE });
	const transition = new OrderTransitionService(outbox);
	const inventory = {
		reserve: jest.fn().mockImplementation(() =>
			Promise.resolve({
				status: 'RESERVED',
				expiresAt: new Date(Date.now() + 900_000).toISOString(),
			}),
		),
		checkReservation: jest.fn().mockResolvedValue({ valid: true }),
		release: jest.fn().mockResolvedValue({ released: true }),
	};
	const payment = {
		createIntent: jest.fn().mockImplementation(({ orderId }) =>
			Promise.resolve({
				intentId: randomUUID(),
				status: 'PENDING',
				checkoutUrl: `http://pay/${orderId}`,
				expiresAt: null,
			}),
		),
	};
	const handler = new CheckoutHandler(
		ds,
		{ get: (_k: string, fallback?: unknown) => fallback } as ConfigService,
		{
			getCart: jest.fn().mockResolvedValue({
				userId,
				items: productIds.map((productId) => ({ productId, quantity: 1 })),
			}),
		} as never,
		{
			priceItems: jest.fn().mockImplementation((lines: any[]) =>
				Promise.resolve({
					items: lines.map((l) => ({ ...l, unitPrice: 100 })),
					subtotal: 100 * lines.length,
					taxAmount: 10 * lines.length,
					shippingFee: 30,
					discountAmount: 0,
					totalAmount: 110 * lines.length + 30,
				}),
			),
		} as never,
		inventory as never,
		payment as never,
		outbox,
		transition,
		new OrderCancellationService(transition),
	);
	return { handler, inventory };
}

describeWithDb('CheckoutHandler (postgres)', ({ it }) => {
	it('checkout lại một phần trùng món: đơn cũ bị huỷ toàn bộ (REPLACED) + outbox; đơn không trùng giữ nguyên', async (ds) => {
		const userId = randomUUID();
		const [a, b, c, d] = [
			randomUUID(),
			randomUUID(),
			randomUUID(),
			randomUUID(),
		];
		const created: string[] = [];

		try {
			const first = buildHandler(ds, userId, [a, b, c]);
			const one = await first.handler.execute(
				new CheckoutCommand(userId, {
					items: [{ productId: a }, { productId: b }, { productId: c }],
					shippingAddress: address,
				}),
			);
			created.push(one.orderId);

			// Món D không trùng: đơn #1 không bị đụng.
			const other = buildHandler(ds, userId, [d]);
			const dOrder = await other.handler.execute(
				new CheckoutCommand(userId, {
					items: [{ productId: d }],
					shippingAddress: address,
				}),
			);
			created.push(dOrder.orderId);
			expect(other.inventory.reserve.mock.calls[0][0].replaces).toEqual([]);

			// Chỉ chọn A: trùng với #1 => #1 bị huỷ toàn bộ, đơn D vẫn chờ.
			const again = buildHandler(ds, userId, [a]);
			const two = await again.handler.execute(
				new CheckoutCommand(userId, {
					items: [{ productId: a }],
					shippingAddress: address,
				}),
			);
			created.push(two.orderId);
			expect(again.inventory.reserve.mock.calls[0][0].replaces).toEqual([
				one.orderId,
			]);

			const rows = await ds.query(
				`SELECT id, status, "cancelReason", version FROM orders WHERE id = ANY($1::uuid[])`,
				[created],
			);
			const byId = new Map<string, any>(rows.map((r: any) => [r.id, r]));
			expect(byId.get(one.orderId)).toMatchObject({
				status: 'CANCELLED',
				cancelReason: 'REPLACED',
				version: 3, // tạo (1) + gắn paymentIntentId (2) + huỷ (3)
			});
			expect(byId.get(dOrder.orderId)).toMatchObject({
				status: 'PENDING_PAYMENT',
				version: 2, // +1 do gắn paymentIntentId
			});
			expect(byId.get(two.orderId).status).toBe('PENDING_PAYMENT');

			const oldEvents = await ds.query(
				`SELECT "eventType" FROM outbox WHERE "source" = $1 AND "key" = $2`,
				[SOURCE, one.orderId],
			);
			const types = oldEvents.map((r: any) => r.eventType);
			expect(types).toEqual(
				expect.arrayContaining([
					'OrderCreated',
					'OrderStatusChanged',
					'CancelPaymentIntent',
					'OrderCancelled',
				]),
			);
			expect(types).not.toContain('ReleaseInventory');
		} finally {
			await ds.query(`DELETE FROM outbox WHERE "source" = $1`, [SOURCE]);
			if (created.length) {
				await ds.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
					created,
				]);
			}
		}
	});
});
