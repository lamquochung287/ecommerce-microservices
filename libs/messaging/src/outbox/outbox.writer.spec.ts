// Mock và raw query trả any theo thiết kế; async mock giữ đúng chữ ký Promise của dependency thật.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { EntityManager } from 'typeorm';
import {
	OutboxMessage,
	OutboxMessageStatus,
} from '../entities/outbox-message.entity';
import { OutboxWriter } from './outbox.writer';

describe('OutboxWriter', () => {
	it('inserts a PENDING row through the given manager with key=orderId and source', async () => {
		const manager = { insert: jest.fn().mockResolvedValue(undefined) };
		const writer = new OutboxWriter({ source: 'inventory' });

		const eventId = await writer.append(manager as unknown as EntityManager, {
			topic: 'inventory-events',
			type: 'InventoryCommitted',
			orderId: 'order-1',
			payload: { a: 1 },
		});

		expect(manager.insert).toHaveBeenCalledTimes(1);
		const [entity, row] = manager.insert.mock.calls[0];
		expect(entity).toBe(OutboxMessage);
		expect(row).toMatchObject({
			eventId,
			source: 'inventory',
			topic: 'inventory-events',
			key: 'order-1',
			eventType: 'InventoryCommitted',
			payload: { a: 1 },
			status: OutboxMessageStatus.PENDING,
		});
		expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('propagates insert failure so the surrounding transaction rolls back', async () => {
		const manager = {
			insert: jest.fn().mockRejectedValue(new Error('db down')),
		};
		const writer = new OutboxWriter({ source: 'orders' });
		await expect(
			writer.append(manager as unknown as EntityManager, {
				topic: 't',
				type: 'X',
				orderId: 'o',
				payload: {},
			}),
		).rejects.toThrow('db down');
	});
});
