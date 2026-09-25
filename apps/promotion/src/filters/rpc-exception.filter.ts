import { AbstractRpcExceptionFilter } from '@lib/common/filters/base-rpc-exception.filter';

export class PromotionRpcExceptionFilter extends AbstractRpcExceptionFilter {
	protected getUniqueConstraintMessage(message: string): string {
		if (message.includes('code')) return 'Voucher with this code already exists';
		return 'Duplicate entry found';
	}
}
