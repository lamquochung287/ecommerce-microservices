// Mock và raw query trả any theo thiết kế; async mock giữ đúng chữ ký Promise của dependency thật.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { describeWithDb } from '../../database/test/integration-data-source';
import { KafkaProducerService } from '../src/kafka/kafka-producer.service';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sent {
	eventId: string;
	key: string;
	relay: string;
}

function buildRelay(
	dataSource: DataSource,
	source: string,
	name: string,
	sent: Sent[],
	sendDelayMs = 0,
) {
	const producer = {
		send: jest.fn(
			async (_topic: string, key: string, envelope: { eventId: string }) => {
				if (sendDelayMs) await sleep(sendDelayMs);
				sent.push({ eventId: envelope.eventId, key, relay: name });
			},
		),
	};
	const config = {
		get: (_k: string, def: unknown) => def,
	} as unknown as ConfigService;
	const relay = new OutboxRelayService(
		dataSource,
		producer as unknown as KafkaProducerService,
		config,
		{ source },
	);
	return { relay, producer };
}

async function insertRow(
	ds: DataSource,
	source: string,
	key: string,
	opts: { delayed?: boolean } = {},
): Promise<string> {
	const eventId = randomUUID();
	await ds.query(
		`INSERT INTO outbox ("eventId", "source", "topic", "key", "eventType", "payload", "nextAttemptAt")
		 VALUES ($1, $2, 'order-events', $3, 'OrderCreated', '{}'::jsonb,
		         now() + ($4 || ' seconds')::interval)`,
		[eventId, source, key, opts.delayed ? '3600' : '-1'],
	);
	return eventId;
}

describeWithDb('OutboxRelayService (postgres)', ({ it }) => {
	const source = `int-${randomUUID()}`;
	let ds: DataSource;

	const cleanup = () =>
		ds.query(`DELETE FROM outbox WHERE "source" = $1`, [source]);

	it('two concurrent relays publish each of 50 rows exactly once', async (dataSource) => {
		ds = dataSource;
		await cleanup();
		const ids = new Set<string>();
		for (let i = 0; i < 50; i++)
			ids.add(await insertRow(ds, source, `order-${i}`));

		const sent: Sent[] = [];
		const a = buildRelay(ds, source, 'A', sent, 15);
		const b = buildRelay(ds, source, 'B', sent, 15);

		for (let round = 0; round < 10 && sent.length < 50; round++) {
			await Promise.all([a.relay.processBatch(), b.relay.processBatch()]);
		}

		expect(sent).toHaveLength(50);
		expect(new Set(sent.map((s) => s.eventId))).toEqual(ids);
		// Cả hai instance đều giữ được row (lock không độc chiếm cả batch).
		expect(new Set(sent.map((s) => s.relay)).size).toBe(2);
		const [{ count }] = await ds.query(
			`SELECT count(*)::int AS count FROM outbox WHERE "source" = $1 AND "status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL`,
			[source],
		);
		expect(count).toBe(50);
		await cleanup();
	});

	it('does not publish seq 2 of a key while seq 1 of the same key is still PENDING', async (dataSource) => {
		ds = dataSource;
		await cleanup();
		const first = await insertRow(ds, source, 'order-A', { delayed: true });
		const second = await insertRow(ds, source, 'order-A');
		const other = await insertRow(ds, source, 'order-B');

		const sent: Sent[] = [];
		const { relay } = buildRelay(ds, source, 'A', sent);

		await relay.processBatch();
		// Chỉ key khác được gửi; seq 2 của order-A bị chặn bởi seq 1 chưa đến hạn.
		expect(sent.map((s) => s.eventId)).toEqual([other]);

		await ds.query(
			`UPDATE outbox SET "nextAttemptAt" = now() - interval '1 second' WHERE "eventId" = $1`,
			[first],
		);
		await relay.processBatch();
		expect(sent.map((s) => s.eventId)).toEqual([other, first]);
		// seq 2 vẫn phải chờ tick sau vì lúc chọn seq 1 còn PENDING.
		await relay.processBatch();
		expect(sent.map((s) => s.eventId)).toEqual([other, first, second]);
		await cleanup();
	});

	it('keeps order within a key inside one batch and stops after a failure', async (dataSource) => {
		ds = dataSource;
		await cleanup();
		await insertRow(ds, source, 'order-C');
		const sent: Sent[] = [];
		const { relay, producer } = buildRelay(ds, source, 'A', sent);
		producer.send.mockRejectedValueOnce(new Error('broker down'));

		await relay.processBatch();

		const [row] = await ds.query(
			`SELECT "status", "retryCount", "lastError", "nextAttemptAt" > now() AS backed_off FROM outbox WHERE "source" = $1`,
			[source],
		);
		expect(row).toMatchObject({
			status: 'PENDING',
			retryCount: 1,
			lastError: 'broker down',
			backed_off: true,
		});
		expect(sent).toHaveLength(0);
		await cleanup();
	});

	afterAll(async () => {
		if (ds?.isInitialized) await cleanup();
	});
});
