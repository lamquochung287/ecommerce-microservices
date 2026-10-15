import { EntityManager } from 'typeorm';

// Chạy trong transaction của consumer (cùng inbox) nên nhận manager từ ngoài.
export class CancelPaymentIntentCommand {
	constructor(
		public readonly manager: EntityManager,
		public readonly orderId: string,
	) {}
}
