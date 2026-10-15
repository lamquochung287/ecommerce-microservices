import { EntityManager } from 'typeorm';

export class CancelShipmentCommand {
	constructor(
		public readonly manager: EntityManager,
		public readonly orderId: string,
	) {}
}
