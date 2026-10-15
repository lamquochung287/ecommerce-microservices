import { EntityManager } from 'typeorm';

export class CreateShipmentCommand {
	/** `manager` là transaction của consumer runner; `payload` chưa được tin cậy. */
	constructor(
		public readonly manager: EntityManager,
		public readonly orderId: string,
		public readonly payload: unknown,
	) {}
}
