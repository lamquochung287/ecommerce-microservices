import { SetMetadata } from '@nestjs/common';
import { Action, ModuleName } from 'libs/constant/permission.constant';

export const PERMISSION_KEY = 'require_permission';
export const RequirePermission = (module: ModuleName, action: Action) =>
	SetMetadata(PERMISSION_KEY, module | action);
