// Raw query trả any theo thiết kế của TypeORM.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { Order, OrderStatus } from '../src/entities/order.entity';
import { OrderTransitionService } from '../src/order-state/order-transition.service';
import { OrderVersionConflictError } from '../src/order-state/order-version-conflict.error';

const SOURCE = `int-${randomUUID()}`;

async function insertOrder(ds: DataSource, id: string): Promise<void> {
	await ds.query(
		`INSERT INTO orders (id, "userId", status, "recipientName", "recipientPhone", "addressLine1", city, country)
		 VALUES ($1, $2, 'PENDING_PAYMENT', 'n', 'p', 'a', 'c', 'VN')`,
		[id, randomUUID()],
	);
}

describeWithDb('OrderTransitionService (postgres)', ({ it }) => {
	it('hai transaction cùng đọc version 1 rồi cùng chuyển: đúng một bên thắng, outbox chỉ 1 OrderStatusChanged', async (ds) => {
		const orderId = randomUUID();
		await insertOrder(ds, orderId);
		const service = new OrderTransitionService(
			new OutboxWriter({ source: SOURCE }),
		);

		try {
			// Rào chắn: cả hai đã đọc version 1 trước khi bên nào UPDATE.
			let readCount = 0;
			let release!: () => void;
			const bothRead = new Promise<void>((resolve) => (release = resolve));

			const attempt = (to: OrderStatus) =>
				ds.transaction(async (manager) => {
					const order = await manager.findOne(Order, {
						where: { id: orderId },
					});
					if (!order) throw new Error('order missing');
					if (++readCount === 2) release();
					await bothRead;
					return service.transition(manager, { order, to });
				});

			const results = await Promise.allSettled([
				attempt(OrderStatus.PAID),
				attempt(OrderStatus.CANCELLED),
			]);

			const fulfilled = results.filter((r) => r.status === 'fulfilled');
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === 'rejected',
			);
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect(rejected[0].reason).toBeInstanceOf(OrderVersionConflictError);

			const [row] = await ds.query(
				`SELECT version, status FROM orders WHERE id = $1`,
				[orderId],
			);
			expect(row.version).toBe(2);

			const outbox = await ds.query(
				`SELECT "eventType" FROM outbox WHERE "source" = $1 AND "key" = $2`,
				[SOURCE, orderId],
			);
			expect(outbox).toHaveLength(1);
			expect(outbox[0].eventType).toBe('OrderStatusChanged');
		} finally {
			await ds.query(`DELETE FROM outbox WHERE "source" = $1`, [SOURCE]);
			await ds.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
		}
	});
});
