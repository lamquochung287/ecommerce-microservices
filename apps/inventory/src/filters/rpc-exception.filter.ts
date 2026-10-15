import { AbstractRpcExceptionFilter } from '@lib/common/filters/base-rpc-exception.filter';

export class InventoryRpcExceptionFilter extends AbstractRpcExceptionFilter {
	protected getUniqueConstraintMessage(message: string): string {
		if (message.includes('orderId'))
			return 'Reservation already exists for this order';
		return 'Duplicate entry found';
	}
}
