import { AbstractRpcExceptionFilter } from '@lib/common/filters/base-rpc-exception.filter';

export class PaymentRpcExceptionFilter extends AbstractRpcExceptionFilter {
	protected getUniqueConstraintMessage(message: string): string {
		if (
			message.includes('idempotency_key') ||
			message.includes('idempotencyKey')
		)
			return 'Payment already processed for this request';
		if (message.includes('event_id') || message.includes('eventId'))
			return 'Webhook event already processed';
		return 'Duplicate entry found';
	}
}
