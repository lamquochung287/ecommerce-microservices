import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

@Injectable()
export class InboxService {
	/**
	 * Đánh dấu (consumer, eventId) đã xử lý trong transaction của `manager`.
	 * true = lần đầu (được xử lý); false = trùng. Rollback transaction sẽ gỡ luôn dấu này nên message được xử lý lại.
	 */
	async tryAcquire(
		manager: EntityManager,
		consumer: string,
		eventId: string,
	): Promise<boolean> {
		const rows: unknown[] = await manager.query(
			`INSERT INTO processed_messages ("consumer", "eventId") VALUES ($1, $2)
			 ON CONFLICT DO NOTHING RETURNING "eventId"`,
			[consumer, eventId],
		);
		return rows.length === 1;
	}
}
