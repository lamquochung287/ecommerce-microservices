// Mock và raw query trả any theo thiết kế; async mock giữ đúng chữ ký Promise của dependency thật.
/* eslint-disable @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import { createEnvelope } from '../src/envelope';
import { KafkaProducerService } from '../src/kafka/kafka-producer.service';

// Cần broker thật: chỉ chạy khi INT_KAFKA được đặt.
const describeKafka = process.env.INT_KAFKA ? describe : describe.skip;
const brokers = process.env.KAFKA_BROKERS ?? 'localhost:9092';

const configFor = (b: string) =>
	({
		get: (k: string, def: unknown) => (k === 'KAFKA_BROKERS' ? b : def),
	}) as unknown as ConfigService;

describeKafka('KafkaProducerService (kafka)', () => {
	it('delivers key and envelope to the broker', async () => {
		const topic = `int-test-${randomUUID()}`;
		const kafka = new Kafka({
			clientId: 'int-test',
			brokers: brokers.split(','),
		});
		const admin = kafka.admin();
		await admin.connect();
		await admin.createTopics({
			waitForLeaders: true,
			topics: [{ topic, numPartitions: 1 }],
		});
		await admin.disconnect();

		const consumer = kafka.consumer({ groupId: `int-${randomUUID()}` });
		await consumer.connect();
		await consumer.subscribe({ topic, fromBeginning: true });
		const received = new Promise<{ key: string; value: unknown; type: string }>(
			(resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error('no message within 30s')),
					30_000,
				);
				void consumer.run({
					eachMessage: async ({ message }) => {
						clearTimeout(timer);
						resolve({
							key: message.key!.toString(),
							value: JSON.parse(message.value!.toString()),
							type: message.headers!.type!.toString(),
						});
					},
				});
			},
		);

		const producer = new KafkaProducerService(configFor(brokers));
		const envelope = createEnvelope({
			type: 'OrderCreated',
			orderId: 'order-42',
			payload: { totalAmount: 10 },
		});
		try {
			await producer.send(topic, 'order-42', envelope, {
				type: 'OrderCreated',
			});
			const msg = await received;
			expect(msg.key).toBe('order-42');
			expect(msg.value).toEqual(envelope);
			expect(msg.type).toBe('OrderCreated');
		} finally {
			await consumer.disconnect();
			await producer.onApplicationShutdown();
		}
	});

	it('rejects when the broker is unreachable', async () => {
		const producer = new KafkaProducerService(configFor('127.0.0.1:1'));
		await expect(
			producer.send(
				'whatever',
				'k',
				createEnvelope({ type: 'X', orderId: 'o', payload: {} }),
			),
		).rejects.toBeDefined();
	});
});
