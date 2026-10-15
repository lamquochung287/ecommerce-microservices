// Raw query trả any theo thiết kế của TypeORM.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'crypto';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { ReservationService } from '../src/domain/reservation.service';
import { ReserveStockDto } from '../src/dto/inventory.dto';

const service = new ReservationService();

const reserve = (ds: DataSource, dto: ReserveStockDto) =>
	ds.transaction((m) => service.reserve(m, dto));

const dtoOf = (
	orderId: string,
	items: { productId: string; quantity: number }[],
	replaces?: string[],
): ReserveStockDto => ({
	orderId,
	items: items.map((i) => ({ ...i, variantId: null })),
	ttlSeconds: 900,
	replaces,
});

async function seedStock(ds: DataSource, onHand: number): Promise<string> {
	const productId = randomUUID();
	await ds.query(
		`INSERT INTO "stock_items" ("productId", "variantId", "onHand") VALUES ($1, NULL, $2)`,
		[productId, onHand],
	);
	return productId;
}

async function stockOf(ds: DataSource, productId: string) {
	const rows = await ds.query(
		`SELECT "onHand", "reserved" FROM "stock_items" WHERE "productId" = $1`,
		[productId],
	);
	return rows[0] as { onHand: number; reserved: number };
}

async function statusOf(ds: DataSource, orderId: string): Promise<string> {
	const rows = await ds.query(
		`SELECT "status" FROM "reservations" WHERE "orderId" = $1`,
		[orderId],
	);
	return rows[0].status as string;
}

async function cleanup(
	ds: DataSource,
	productIds: string[],
	orderIds: string[],
) {
	await ds.query(
		`DELETE FROM "reservations" WHERE "orderId" = ANY($1::uuid[])`,
		[orderIds],
	);
	await ds.query(
		`DELETE FROM "stock_items" WHERE "productId" = ANY($1::uuid[])`,
		[productIds],
	);
}

const statusCodeOf = (err: unknown) =>
	err instanceof RpcException
		? (err.getError() as { statusCode: number }).statusCode
		: undefined;

describeWithDb('Inventory reservation (Postgres)', ({ it }) => {
	it('hàng còn 1, 2 đơn khác nhau reserve song song: đúng 1 thành công', async (ds) => {
		const product = await seedStock(ds, 1);
		const orders = [randomUUID(), randomUUID()];
		try {
			const results = await Promise.allSettled(
				orders.map((id) =>
					reserve(ds, dtoOf(id, [{ productId: product, quantity: 1 }])),
				),
			);

			const fulfilled = results.filter((r) => r.status === 'fulfilled');
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === 'rejected',
			);
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect(statusCodeOf(rejected[0].reason)).toBe(409);
			expect((await stockOf(ds, product)).reserved).toBe(1);
		} finally {
			await cleanup(ds, [product], orders);
		}
	});

	it('replaces: hàng còn 1 và đơn cũ giữ đúng món đó -> thành công, đơn cũ RELEASED', async (ds) => {
		const product = await seedStock(ds, 1);
		const [oldOrder, newOrder] = [randomUUID(), randomUUID()];
		try {
			await reserve(ds, dtoOf(oldOrder, [{ productId: product, quantity: 1 }]));

			await reserve(
				ds,
				dtoOf(newOrder, [{ productId: product, quantity: 1 }], [oldOrder]),
			);

			expect(await statusOf(ds, oldOrder)).toBe('RELEASED');
			expect(await statusOf(ds, newOrder)).toBe('RESERVED');
			expect((await stockOf(ds, product)).reserved).toBe(1);
		} finally {
			await cleanup(ds, [product], [oldOrder, newOrder]);
		}
	});

	it('replaces + món mới thiếu hàng -> 409 và đơn cũ vẫn RESERVED', async (ds) => {
		const kept = await seedStock(ds, 1);
		const scarce = await seedStock(ds, 0);
		const [oldOrder, newOrder] = [randomUUID(), randomUUID()];
		try {
			await reserve(ds, dtoOf(oldOrder, [{ productId: kept, quantity: 1 }]));

			const err = await reserve(
				ds,
				dtoOf(
					newOrder,
					[
						{ productId: kept, quantity: 1 },
						{ productId: scarce, quantity: 1 },
					],
					[oldOrder],
				),
			).catch((e: unknown) => e);

			expect(statusCodeOf(err)).toBe(409);
			expect(await statusOf(ds, oldOrder)).toBe('RESERVED');
			expect((await stockOf(ds, kept)).reserved).toBe(1);
			const rows = await ds.query(
				`SELECT 1 FROM "reservations" WHERE "orderId" = $1`,
				[newOrder],
			);
			expect(rows).toHaveLength(0);
		} finally {
			await cleanup(ds, [kept, scarce], [oldOrder, newOrder]);
		}
	});

	it('2 đơn reserve chéo thứ tự sản phẩm song song: không deadlock', async (ds) => {
		const a = await seedStock(ds, 1000);
		const b = await seedStock(ds, 1000);
		const orders: string[] = [];
		try {
			for (let round = 0; round < 15; round++) {
				const [x, y] = [randomUUID(), randomUUID()];
				orders.push(x, y);
				await Promise.all([
					reserve(
						ds,
						dtoOf(x, [
							{ productId: a, quantity: 1 },
							{ productId: b, quantity: 1 },
						]),
					),
					reserve(
						ds,
						dtoOf(y, [
							{ productId: b, quantity: 1 },
							{ productId: a, quantity: 1 },
						]),
					),
				]);
			}

			expect((await stockOf(ds, a)).reserved).toBe(30);
			expect((await stockOf(ds, b)).reserved).toBe(30);
		} finally {
			await cleanup(ds, [a, b], orders);
		}
	});

	it('release trả reserved và idempotent; expireOne trả phần giữ của reservation quá hạn', async (ds) => {
		const product = await seedStock(ds, 5);
		const [released, expired] = [randomUUID(), randomUUID()];
		try {
			await reserve(ds, dtoOf(released, [{ productId: product, quantity: 2 }]));
			await reserve(ds, dtoOf(expired, [{ productId: product, quantity: 1 }]));

			await ds.transaction((m) => service.release(m, released));
			const again = await ds.transaction((m) => service.release(m, released));
			expect(again).toEqual({ released: false });
			expect((await stockOf(ds, product)).reserved).toBe(1);

			await ds.query(
				`UPDATE "reservations" SET "expiresAt" = now() - interval '1 hour' WHERE "orderId" = $1`,
				[expired],
			);
			const rows: { id: string }[] = await ds.query(
				`SELECT "id" FROM "reservations" WHERE "orderId" = $1`,
				[expired],
			);
			await ds.transaction((m) => service.expireOne(m, rows[0].id, new Date()));

			expect(await statusOf(ds, expired)).toBe('EXPIRED');
			expect((await stockOf(ds, product)).reserved).toBe(0);
		} finally {
			await cleanup(ds, [product], [released, expired]);
		}
	});

	it('CHECK từ chối reserved > onHand ở tầng DB', async (ds) => {
		const product = await seedStock(ds, 1);
		try {
			await expect(
				ds.query(
					`UPDATE "stock_items" SET "reserved" = 2 WHERE "productId" = $1`,
					[product],
				),
			).rejects.toThrow(/CHK_stock_items_reserved/);
		} finally {
			await cleanup(ds, [product], []);
		}
	});
});
