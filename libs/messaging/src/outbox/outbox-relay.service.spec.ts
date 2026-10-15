// Mock và raw query trả any theo thiết kế; async mock giữ đúng chữ ký Promise của dependency thật.
/* eslint-disable @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { OutboxRelayService } from './outbox-relay.service';

const row = (n: number, retryCount = 0, key = 'order-1') => ({
	id: `id-${n}`,
	eventId: `evt-${n}`,
	topic: 'order-events',
	key,
	eventType: 'OrderCreated',
	payload: { n },
	retryCount,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

interface Update {
	sql: string;
	params: unknown[];
}

function build(
	rows: ReturnType<typeof row>[],
	opts: { maxRetry?: number } = {},
) {
	const updates: Update[] = [];
	const log: string[] = [];
	const manager = {
		query: jest.fn(async (sql: string, params: unknown[]) => {
			if (sql.includes('SELECT')) return rows;
			log.push('update');
			updates.push({ sql, params });
			return undefined;
		}),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: unknown) => Promise<void>) => cb(manager)),
	};
	const producer = {
		send: jest.fn(async () => {
			log.push('send');
		}),
	};
	const config = {
		get: (key: string, def: unknown) =>
			key === 'OUTBOX_MAX_RETRY' && opts.maxRetry ? opts.maxRetry : def,
	};
	const relay = new OutboxRelayService(
		dataSource as unknown as DataSource,
		producer as unknown as KafkaProducerService,
		config as unknown as ConfigService,
		{ source: 'orders' },
	);
	return { relay, producer, updates, log, dataSource };
}

describe('OutboxRelayService', () => {
	it('marks PUBLISHED only after send resolves', async () => {
		const { relay, producer, updates, log } = build([row(1)]);

		await relay.processBatch();

		expect(log).toEqual(['send', 'update']);
		expect(updates[0].sql).toContain("'PUBLISHED'");
		expect(updates[0].params).toEqual(['id-1']);
		const [topic, key, envelope, headers] = producer.send.mock
			.calls[0] as unknown[];
		expect(topic).toBe('order-events');
		expect(key).toBe('order-1');
		expect(envelope).toMatchObject({
			eventId: 'evt-1',
			type: 'OrderCreated',
			orderId: 'order-1',
			version: 1,
			payload: { n: 1 },
		});
		expect(headers).toEqual({ type: 'OrderCreated' });
	});

	it('keeps the row PENDING with retryCount+1 and backoff when send rejects', async () => {
		const { relay, producer, updates } = build([row(1, 0)]);
		producer.send.mockRejectedValue(new Error('broker down'));

		await relay.processBatch();

		expect(updates).toHaveLength(1);
		expect(updates[0].sql).not.toContain('PUBLISHED');
		expect(updates[0].sql).not.toContain('FAILED');
		expect(updates[0].params.slice(0, 3)).toEqual(['id-1', 1, 'broker down']);
		expect(updates[0].params[3]).toBe(2000);
	});

	it('backoff grows with retryCount and is capped at 60s', async () => {
		const a = build([row(1, 2)]);
		a.producer.send.mockRejectedValue(new Error('x'));
		await a.relay.processBatch();
		const b = build([row(1, 8)], { maxRetry: 20 });
		b.producer.send.mockRejectedValue(new Error('x'));
		await b.relay.processBatch();

		expect(a.updates[0].params[3]).toBe(8000);
		expect(b.updates[0].params[3]).toBe(60000);
	});

	it('moves the row to FAILED once retries reach OUTBOX_MAX_RETRY', async () => {
		const { relay, producer, updates } = build([row(1, 9)]);
		producer.send.mockRejectedValue(new Error('still down'));

		await relay.processBatch();

		expect(updates).toHaveLength(1);
		expect(updates[0].sql).toContain("'FAILED'");
		expect(updates[0].params).toEqual(['id-1', 10, 'still down']);
	});

	it('stops the batch at the first failure so later rows are not sent', async () => {
		const { relay, producer, updates } = build([row(1), row(2)]);
		producer.send.mockRejectedValueOnce(new Error('fail first'));

		await relay.processBatch();

		expect(producer.send).toHaveBeenCalledTimes(1);
		expect(updates).toHaveLength(1);
		expect(updates[0].params[0]).toBe('id-1');
	});

	it('publishes rows in order and marks each', async () => {
		const { relay, producer, updates } = build([row(1), row(2)]);
		await relay.processBatch();
		const ids = producer.send.mock.calls.map(
			(c) => (c as unknown as [string, string, { eventId: string }])[2].eventId,
		);
		expect(ids).toEqual(['evt-1', 'evt-2']);
		expect(updates.map((u) => u.params[0])).toEqual(['id-1', 'id-2']);
	});

	it('does not run overlapping ticks', async () => {
		const { relay, producer, dataSource } = build([row(1)]);
		let release!: () => void;
		producer.send.mockImplementationOnce(
			() => new Promise<void>((resolve) => (release = resolve)),
		);

		const first = relay.processBatch();
		await new Promise((r) => setImmediate(r));
		await relay.processBatch();
		expect(dataSource.transaction).toHaveBeenCalledTimes(1);

		release();
		await first;
		await relay.processBatch();
		expect(dataSource.transaction).toHaveBeenCalledTimes(2);
	});

	it('never throws when the transaction itself fails', async () => {
		const { relay, dataSource } = build([]);
		dataSource.transaction.mockRejectedValue(new Error('conn lost'));
		await expect(relay.processBatch()).resolves.toBeUndefined();
	});
});
