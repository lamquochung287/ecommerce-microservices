// Raw query trả any theo thiết kế của TypeORM.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { Order, OrderStatus } from '../src/entities/order.entity';
import { OrderCancelReason } from '../src/order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../src/order-state/order-cancellation.service';
import { OrderTransitionService } from '../src/order-state/order-transition.service';
import { OrderVersionConflictError } from '../src/order-state/order-version-conflict.error';

const SOURCE = `int-${randomUUID()}`;

async function insertFulfillingOrder(
	ds: DataSource,
	id: string,
): Promise<void> {
	await ds.query(
		`INSERT INTO orders (id, "userId", status, "totalAmount", "shippingFee", "recipientName", "recipientPhone", "addressLine1", city, country)
		 VALUES ($1, $2, 'FULFILLING', 230000, 30000, 'n', 'p', 'a', 'c', 'VN')`,
		[id, randomUUID()],
	);
}

describeWithDb('Huỷ đơn đua với ShipmentCreated (postgres)', ({ it }) => {
	it('user huỷ và FULFILLING -> SHIPPED cùng version: đúng một bên thắng; huỷ thắng thì outbox có CancelShipment, thua thì 409 và không có', async (ds) => {
		const orderId = randomUUID();
		await insertFulfillingOrder(ds, orderId);
		const transition = new OrderTransitionService(
			new OutboxWriter({ source: SOURCE }),
		);
		const cancellation = new OrderCancellationService(transition);

		try {
			// Rào chắn: cả hai đã đọc cùng version trước khi bên nào UPDATE.
			let readCount = 0;
			let release!: () => void;
			const bothRead = new Promise<void>((resolve) => (release = resolve));
			const readOrder = async (manager: EntityManager) => {
				const order = await manager.findOne(Order, { where: { id: orderId } });
				if (!order) throw new Error('order missing');
				if (++readCount === 2) release();
				await bothRead;
				return order;
			};

			const results = await Promise.allSettled([
				ds.transaction(async (manager) =>
					cancellation.cancelPaid(
						manager,
						await readOrder(manager),
						OrderCancelReason.USER,
						{ restock: true, cancelShipment: true },
					),
				),
				ds.transaction(async (manager) =>
					transition.transition(manager, {
						order: await readOrder(manager),
						to: OrderStatus.SHIPPED,
					}),
				),
			]);

			const [cancelResult, shippedResult] = results;
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const loser = results.find(
				(r): r is PromiseRejectedResult => r.status === 'rejected',
			);
			expect(loser?.reason).toBeInstanceOf(OrderVersionConflictError);

			const [row] = await ds.query(
				`SELECT status, version FROM orders WHERE id = $1`,
				[orderId],
			);
			expect(row.version).toBe(2);

			const types: string[] = (
				await ds.query(
					`SELECT "eventType" FROM outbox WHERE "source" = $1 AND "key" = $2`,
					[SOURCE, orderId],
				)
			).map((r: { eventType: string }) => r.eventType);

			if (cancelResult.status === 'fulfilled') {
				expect(row.status).toBe(OrderStatus.CANCELLED);
				expect(types).toContain('CancelShipment');
				expect(types).toContain('RefundPayment');
				expect(types).toContain('RestockInventory');
			} else {
				expect(shippedResult.status).toBe('fulfilled');
				expect(row.status).toBe(OrderStatus.SHIPPED);
				expect(types).not.toContain('CancelShipment');
				expect(types).not.toContain('RefundPayment');
			}
		} finally {
			await ds.query(`DELETE FROM outbox WHERE "source" = $1`, [SOURCE]);
			await ds.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
		}
	});
});
