import { EntityManager } from 'typeorm';

export class RefundPaymentCommand {
	constructor(
		public readonly manager: EntityManager,
		public readonly orderId: string,
		public readonly amount: number,
		public readonly reason: string,
	) {}
}
