// Mock và raw query trả any theo thiết kế; async mock giữ đúng chữ ký Promise của dependency thật.
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { EntityManager } from 'typeorm';
import { InboxService } from './inbox.service';

describe('InboxService', () => {
	const service = new InboxService();
	const managerReturning = (rows: unknown[]) => {
		const query = jest.fn().mockResolvedValue(rows);
		return { manager: { query } as unknown as EntityManager, query };
	};

	it('returns true when the row was inserted (first delivery)', async () => {
		const { manager, query } = managerReturning([{ eventId: 'e1' }]);
		await expect(
			service.tryAcquire(manager, 'orders-service', 'e1'),
		).resolves.toBe(true);
		expect(query.mock.calls[0][1]).toEqual(['orders-service', 'e1']);
	});

	it('returns false when (consumer, eventId) already exists', async () => {
		const { manager } = managerReturning([]);
		await expect(
			service.tryAcquire(manager, 'orders-service', 'e1'),
		).resolves.toBe(false);
	});
});
