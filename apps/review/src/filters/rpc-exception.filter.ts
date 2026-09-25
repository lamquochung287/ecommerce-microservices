import { AbstractRpcExceptionFilter } from '@lib/common/filters/base-rpc-exception.filter';

export class ReviewRpcExceptionFilter extends AbstractRpcExceptionFilter {
	protected getUniqueConstraintMessage(message: string): string {
		return 'You have already reviewed this product for this order';
	}
}
