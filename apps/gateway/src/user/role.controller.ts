import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Body,
	Param,
	UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { UserService } from './user.service';
import {
	CreateRoleDto,
	UpdateRoleDto,
	AssignRoleDto,
} from '../../../user/src/role/role.dto';

@ApiTags('Roles & Permissions')
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RoleController {
	constructor(private readonly userService: UserService) {}

	@Post()
	@RequirePermission(ModuleName.USER, Action.CREATE)
	createRole(@Body() dto: CreateRoleDto) {
		return this.userService.createRole(dto);
	}

	@Get()
	@RequirePermission(ModuleName.USER, Action.READ)
	getRoles() {
		return this.userService.getRoles();
	}

	@Put(':id')
	@RequirePermission(ModuleName.USER, Action.UPDATE)
	updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
		return this.userService.updateRole(id, dto);
	}

	@Delete(':id')
	@RequirePermission(ModuleName.USER, Action.DELETE)
	deleteRole(@Param('id') id: string) {
		return this.userService.deleteRole(id);
	}

	@Post('assign')
	@RequirePermission(ModuleName.USER, Action.UPDATE)
	assignRole(@Body() dto: AssignRoleDto) {
		return this.userService.assignRole(dto);
	}

	@Post('remove')
	@RequirePermission(ModuleName.USER, Action.UPDATE)
	removeRole(@Body() dto: AssignRoleDto) {
		return this.userService.removeRole(dto);
	}
}
