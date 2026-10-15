import { EntityManager } from 'typeorm';

/** Chạy trong transaction của consumer Kafka (chung với inbox). */
export class ConfirmVoucherCommand {
	constructor(
		public readonly manager: EntityManager,
		public readonly orderId: string,
	) {}
}
