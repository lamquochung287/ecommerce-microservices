import {
	Injectable,
	CanActivate,
	ExecutionContext,
	ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorator/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorator/public.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
	constructor(private reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) return true;

		const requiredPermission = this.reflector.getAllAndOverride<number>(
			PERMISSION_KEY,
			[context.getHandler(), context.getClass()],
		);

		if (requiredPermission === undefined || requiredPermission === null) {
			return true; // No permission required
		}

		const { user } = context.switchToHttp().getRequest();
		if (!user) {
			throw new ForbiddenException('User is not authenticated');
		}

		// Ensure permissions is a number
		const userPermissions = Number(user.permissions) || 0;

		// Check if user has ALL required bits
		// (userPermissions & requiredPermission) === requiredPermission
		const hasPermission =
			(userPermissions & requiredPermission) === requiredPermission;

		if (!hasPermission) {
			throw new ForbiddenException(
				'You do not have permission to perform this action',
			);
		}

		return true;
	}
}
