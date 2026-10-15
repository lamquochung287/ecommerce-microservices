import { EntityManager } from 'typeorm';
import { MessageEnvelope } from '@lib/messaging';

// Một message trên payment-commands, đã qua inbox, đang chạy trong transaction `manager`.
export class HandlePaymentCommandMessageCommand {
	constructor(
		public readonly manager: EntityManager,
		public readonly envelope: MessageEnvelope,
	) {}
}
