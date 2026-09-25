import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ROLE_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { RoleService } from './role.service';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './role.dto';

@Controller()
export class RoleController {
	constructor(private readonly roleService: RoleService) {}

	@MessagePattern({ cmd: ROLE_MESSAGE_PATTERN.CREATE_ROLE })
	createRole(@Payload() dto: CreateRoleDto) {
		return this.roleService.createRole(dto);
	}

	@MessagePattern({ cmd: ROLE_MESSAGE_PATTERN.GET_ROLES })
	getRoles() {
		return this.roleService.getRoles();
	}

	@MessagePattern({ cmd: ROLE_MESSAGE_PATTERN.UPDATE_ROLE })
	updateRole(@Payload() payload: { id: string; dto: UpdateRoleDto }) {
		return this.roleService.updateRole(payload.id, payload.dto);
	}

	@MessagePattern({ cmd: ROLE_MESSAGE_PATTERN.DELETE_ROLE })
	deleteRole(@Payload() data: { id: string }) {
		return this.roleService.deleteRole(data.id);
	}

	@MessagePattern({ cmd: ROLE_MESSAGE_PATTERN.ASSIGN_ROLE })
	assignRole(@Payload() dto: AssignRoleDto) {
		return this.roleService.assignRole(dto);
	}

	@MessagePattern({ cmd: ROLE_MESSAGE_PATTERN.REMOVE_ROLE })
	removeRole(@Payload() dto: AssignRoleDto) {
		return this.roleService.removeRole(dto);
	}
}
