import { AbstractRpcExceptionFilter } from '@lib/common/filters/base-rpc-exception.filter';

export class UserRpcExceptionFilter extends AbstractRpcExceptionFilter {
	protected getUniqueConstraintMessage(message: string): string {
		if (message.includes('email')) return 'User with this email already exists';
		if (message.includes('username'))
			return 'User with this username already exists';
		if (message.includes('phone'))
			return 'User with this phone number already exists';
		return 'Duplicate entry found';
	}
}
