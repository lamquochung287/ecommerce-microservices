// Raw query và jest.fn() trả any theo thiết kế.

import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
	InboxService,
	KafkaConsumerRunner,
	KafkaProducerService,
	OutboxWriter,
	createEnvelope,
} from '@lib/messaging';
import {
	KAFKA_TOPIC,
	MESSAGE_TYPE,
	OUTBOX_SOURCE,
} from 'libs/constant/kafka.constant';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { HandleInventoryCommandMessage } from '../src/commands/handle-inventory-command-message.command';
import { HandleInventoryCommandMessageHandler } from '../src/commands/handlers/handle-inventory-command-message.handler';
import { ReservationService } from '../src/domain/reservation.service';

const service = new ReservationService();

function buildHandler(dataSource: DataSource) {
	const config = {
		get: (_key: string, fallback: unknown) => fallback,
	} as unknown as ConfigService;
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const runner = new KafkaConsumerRunner(
		dataSource,
		new InboxService(),
		producer as unknown as KafkaProducerService,
		config,
	);
	const handler = new HandleInventoryCommandMessageHandler(
		runner,
		service,
		new OutboxWriter({ source: OUTBOX_SOURCE.INVENTORY }),
	);
	return (type: string, orderId: string) =>
		handler.execute(
			new HandleInventoryCommandMessage(
				createEnvelope({ type, orderId, payload: {} }),
				KAFKA_TOPIC.INVENTORY_COMMANDS,
			),
		);
}

async function setupOrder(ds: DataSource, onHand: number, quantity: number) {
	const productId = randomUUID();
	const orderId = randomUUID();
	await ds.query(
		`INSERT INTO "stock_items" ("productId", "variantId", "onHand") VALUES ($1, NULL, $2)`,
		[productId, onHand],
	);
	await ds.transaction((m) =>
		service.reserve(m, {
			orderId,
			items: [{ productId, variantId: null, quantity }],
			ttlSeconds: 900,
		}),
	);
	return { productId, orderId };
}

async function stockOf(ds: DataSource, productId: string) {
	const rows: { onHand: number; reserved: number }[] = await ds.query(
		`SELECT "onHand", "reserved" FROM "stock_items" WHERE "productId" = $1`,
		[productId],
	);
	return rows[0];
}

async function statusOf(ds: DataSource, orderId: string) {
	const rows: { status: string }[] = await ds.query(
		`SELECT "status" FROM "reservations" WHERE "orderId" = $1`,
		[orderId],
	);
	return rows[0].status;
}

async function outboxTypes(ds: DataSource, orderId: string) {
	const rows: { eventType: string; topic: string; source: string }[] =
		await ds.query(
			`SELECT "eventType", "topic", "source" FROM "outbox" WHERE "key" = $1 ORDER BY "seq"`,
			[orderId],
		);
	return rows;
}

async function cleanup(ds: DataSource, productId: string, orderId: string) {
	await ds.query(`DELETE FROM "outbox" WHERE "key" = $1`, [orderId]);
	await ds.query(`DELETE FROM "reservations" WHERE "orderId" = $1`, [orderId]);
	await ds.query(`DELETE FROM "stock_items" WHERE "productId" = $1`, [
		productId,
	]);
}

describeWithDb('Inventory commands (Postgres)', ({ it }) => {
	it('Commit rồi Restock (đúng thứ tự partition): onHand về như ban đầu, reserved = 0', async (ds) => {
		const { productId, orderId } = await setupOrder(ds, 10, 3);
		const send = buildHandler(ds);
		try {
			await send(MESSAGE_TYPE.COMMIT_INVENTORY, orderId);
			expect(await stockOf(ds, productId)).toEqual({ onHand: 7, reserved: 0 });
			expect(await statusOf(ds, orderId)).toBe('COMMITTED');

			await send(MESSAGE_TYPE.RESTOCK_INVENTORY, orderId);
			expect(await stockOf(ds, productId)).toEqual({
				onHand: 10,
				reserved: 0,
			});
			expect(await statusOf(ds, orderId)).toBe('RESTOCKED');

			// lặp lại là no-op
			await send(MESSAGE_TYPE.RESTOCK_INVENTORY, orderId);
			expect(await stockOf(ds, productId)).toEqual({
				onHand: 10,
				reserved: 0,
			});
		} finally {
			await cleanup(ds, productId, orderId);
		}
	});

	it('Commit ghi InventoryCommitted vào outbox (source inventory, topic inventory-events) cùng transaction', async (ds) => {
		const { productId, orderId } = await setupOrder(ds, 5, 1);
		const send = buildHandler(ds);
		try {
			await send(MESSAGE_TYPE.COMMIT_INVENTORY, orderId);

			expect(await outboxTypes(ds, orderId)).toEqual([
				{
					eventType: MESSAGE_TYPE.INVENTORY_COMMITTED,
					topic: KAFKA_TOPIC.INVENTORY_EVENTS,
					source: OUTBOX_SOURCE.INVENTORY,
				},
			]);
		} finally {
			await cleanup(ds, productId, orderId);
		}
	});

	it('Restock tới trước Commit: RELEASED, Commit sau đó ra InventoryCommitFailed và kho không đổi', async (ds) => {
		const { productId, orderId } = await setupOrder(ds, 5, 2);
		const send = buildHandler(ds);
		try {
			await send(MESSAGE_TYPE.RESTOCK_INVENTORY, orderId);
			await send(MESSAGE_TYPE.COMMIT_INVENTORY, orderId);

			expect(await statusOf(ds, orderId)).toBe('RELEASED');
			expect(await stockOf(ds, productId)).toEqual({ onHand: 5, reserved: 0 });
			expect((await outboxTypes(ds, orderId)).map((r) => r.eventType)).toEqual([
				MESSAGE_TYPE.INVENTORY_COMMIT_FAILED,
			]);
		} finally {
			await cleanup(ds, productId, orderId);
		}
	});

	it('cùng eventId gửi hai lần (inbox thật): chỉ xử lý một lần', async (ds) => {
		const { productId, orderId } = await setupOrder(ds, 5, 1);
		const config = {
			get: (_key: string, fallback: unknown) => fallback,
		} as unknown as ConfigService;
		const runner = new KafkaConsumerRunner(
			ds,
			new InboxService(),
			{ send: jest.fn() } as unknown as KafkaProducerService,
			config,
		);
		const handler = new HandleInventoryCommandMessageHandler(
			runner,
			service,
			new OutboxWriter({ source: OUTBOX_SOURCE.INVENTORY }),
		);
		const envelope = createEnvelope({
			type: MESSAGE_TYPE.COMMIT_INVENTORY,
			orderId,
			payload: {},
		});
		try {
			for (let i = 0; i < 2; i++) {
				await handler.execute(
					new HandleInventoryCommandMessage(
						envelope,
						KAFKA_TOPIC.INVENTORY_COMMANDS,
					),
				);
			}

			expect(await outboxTypes(ds, orderId)).toHaveLength(1);
			expect(await stockOf(ds, productId)).toEqual({ onHand: 4, reserved: 0 });
		} finally {
			await ds.query(
				`DELETE FROM "processed_messages" WHERE "consumer" = 'inventory-service' AND "eventId" = $1`,
				[envelope.eventId],
			);
			await cleanup(ds, productId, orderId);
		}
	});
});
