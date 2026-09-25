import { AbstractRpcExceptionFilter } from '@lib/common/filters/base-rpc-exception.filter';

export class NotificationRpcExceptionFilter extends AbstractRpcExceptionFilter {
	protected getUniqueConstraintMessage(message: string): string {
		return 'Duplicate entry found';
	}
}
