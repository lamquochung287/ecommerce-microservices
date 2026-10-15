// Mock và raw query trả any theo thiết kế; async mock giữ đúng chữ ký Promise của dependency thật.
/* eslint-disable @typescript-eslint/require-await */
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createEnvelope } from '../envelope';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { KafkaConsumerRunner } from './kafka-consumer.runner';

const TOPIC = 'shipping-commands';

function build(acquire = true) {
	const manager = {};
	const events: string[] = [];
	const dataSource = {
		transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
			events.push('tx-start');
			await cb(manager);
			events.push('tx-commit');
		}),
	};
	const inbox = { tryAcquire: jest.fn(async () => acquire) };
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const config = {
		get: (key: string, def: unknown) =>
			key === 'KAFKA_CONSUMER_RETRY_BACKOFF_MS' ? 0 : def,
	};
	const runner = new KafkaConsumerRunner(
		dataSource as unknown as DataSource,
		inbox,
		producer as unknown as KafkaProducerService,
		config as unknown as ConfigService,
	);
	return { runner, dataSource, inbox, producer, manager, events };
}

const envelope = () =>
	createEnvelope({ type: 'CreateShipment', orderId: 'order-1', payload: {} });

describe('KafkaConsumerRunner', () => {
	it('skips handle for a duplicate (inbox already has the event)', async () => {
		const { runner, producer } = build(false);
		const handle = jest.fn();

		await runner.run({
			consumer: 'c',
			topic: TOPIC,
			message: envelope(),
			handle,
		});

		expect(handle).not.toHaveBeenCalled();
		expect(producer.send).not.toHaveBeenCalled();
	});

	it('runs handle inside the transaction with the inbox manager', async () => {
		const { runner, manager, inbox } = build(true);
		const handle = jest.fn().mockResolvedValue(undefined);
		const env = envelope();

		await runner.run({
			consumer: 'orders-service',
			topic: TOPIC,
			message: env,
			handle,
		});

		expect(inbox.tryAcquire).toHaveBeenCalledWith(
			manager,
			'orders-service',
			env.eventId,
		);
		expect(handle).toHaveBeenCalledWith(manager, env);
	});

	it('retries: fails twice then succeeds = 3 transactions, no DLQ', async () => {
		const { runner, dataSource, producer } = build(true);
		const handle = jest
			.fn()
			.mockRejectedValueOnce(new Error('e1'))
			.mockRejectedValueOnce(new Error('e2'))
			.mockResolvedValueOnce(undefined);
		const onExhausted = jest.fn();

		await runner.run({
			consumer: 'c',
			topic: TOPIC,
			message: envelope(),
			handle,
			onExhausted,
		});

		expect(dataSource.transaction).toHaveBeenCalledTimes(3);
		expect(handle).toHaveBeenCalledTimes(3);
		expect(producer.send).not.toHaveBeenCalled();
		expect(onExhausted).not.toHaveBeenCalled();
	});

	it('fails 3 times: one DLQ send + one onExhausted, does not throw', async () => {
		const { runner, dataSource, producer } = build(true);
		const handle = jest.fn().mockRejectedValue(new Error('boom'));
		const onExhausted = jest.fn().mockResolvedValue(undefined);
		const env = envelope();

		await expect(
			runner.run({
				consumer: 'c',
				topic: TOPIC,
				message: env,
				handle,
				onExhausted,
			}),
		).resolves.toBeUndefined();

		expect(dataSource.transaction).toHaveBeenCalledTimes(3);
		expect(producer.send).toHaveBeenCalledTimes(1);
		const [topic, key, value, headers] = producer.send.mock
			.calls[0] as unknown[];
		expect(topic).toBe('shipping-commands.dlq');
		expect(key).toBe('order-1');
		expect(value).toBe(env);
		expect(headers).toEqual({ error: 'boom', attempts: '3' });
		expect(onExhausted).toHaveBeenCalledTimes(1);
		expect(onExhausted).toHaveBeenCalledWith(
			env,
			expect.objectContaining({ message: 'boom' }),
		);
	});

	it('invalid envelope goes to DLQ immediately without retry or handle', async () => {
		const { runner, dataSource, producer } = build(true);
		const handle = jest.fn();
		const onExhausted = jest.fn();
		const bad: Record<string, unknown> = { ...envelope() };
		delete bad.eventId;

		await runner.run({
			consumer: 'c',
			topic: TOPIC,
			message: bad,
			handle,
			onExhausted,
		});

		expect(dataSource.transaction).not.toHaveBeenCalled();
		expect(handle).not.toHaveBeenCalled();
		expect(producer.send).toHaveBeenCalledTimes(1);
		const call = producer.send.mock.calls[0] as unknown[];
		expect(call[0]).toBe('shipping-commands.dlq');
		expect(call[3]).toMatchObject({ attempts: '0' });
		expect(onExhausted).not.toHaveBeenCalled();
	});

	it('throws when the DLQ send fails so the offset is not committed', async () => {
		const { runner, producer } = build(true);
		producer.send.mockRejectedValue(new Error('dlq down'));
		const handle = jest.fn().mockRejectedValue(new Error('boom'));
		const onExhausted = jest.fn();

		await expect(
			runner.run({
				consumer: 'c',
				topic: TOPIC,
				message: envelope(),
				handle,
				onExhausted,
			}),
		).rejects.toThrow('dlq down');
		expect(onExhausted).not.toHaveBeenCalled();
	});

	it('throws when the invalid-envelope DLQ send fails', async () => {
		const { runner, producer } = build(true);
		producer.send.mockRejectedValue(new Error('dlq down'));
		await expect(
			runner.run({
				consumer: 'c',
				topic: TOPIC,
				message: { nope: 1 },
				handle: jest.fn(),
			}),
		).rejects.toThrow('dlq down');
	});

	it('throws when onExhausted fails so the message is redelivered rather than lost', async () => {
		const { runner } = build(true);
		await expect(
			runner.run({
				consumer: 'c',
				topic: TOPIC,
				message: envelope(),
				handle: jest.fn().mockRejectedValue(new Error('boom')),
				onExhausted: jest.fn().mockRejectedValue(new Error('outbox down')),
			}),
		).rejects.toThrow('outbox down');
	});

	it('runs afterCommit only after the transaction commits', async () => {
		const { runner, events } = build(true);
		const afterCommit = jest.fn(async () => {
			events.push('after-commit');
		});

		await runner.run({
			consumer: 'c',
			topic: TOPIC,
			message: envelope(),
			handle: async () => ({ afterCommit }),
		});

		expect(events).toEqual(['tx-start', 'tx-commit', 'after-commit']);
	});

	it('does not run afterCommit when every attempt fails', async () => {
		const { runner, producer } = build(true);
		const afterCommit = jest.fn();
		const handle = jest.fn(async () => {
			throw new Error('boom');
			return { afterCommit };
		});

		await runner.run({
			consumer: 'c',
			topic: TOPIC,
			message: envelope(),
			handle,
		});

		expect(afterCommit).not.toHaveBeenCalled();
		expect(producer.send).toHaveBeenCalledTimes(1);
	});

	it('swallows afterCommit errors without retrying or DLQ', async () => {
		const { runner, dataSource, producer } = build(true);
		const afterCommit = jest.fn().mockRejectedValue(new Error('redis down'));

		await expect(
			runner.run({
				consumer: 'c',
				topic: TOPIC,
				message: envelope(),
				handle: async () => ({ afterCommit }),
			}),
		).resolves.toBeUndefined();

		expect(afterCommit).toHaveBeenCalledTimes(1);
		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		expect(producer.send).not.toHaveBeenCalled();
	});
});
