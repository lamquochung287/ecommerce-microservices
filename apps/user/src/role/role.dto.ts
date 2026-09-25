import { IsString, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class CreateRoleDto {
	@IsString()
	name: string;

	@IsNumber()
	permissions: number;
}

export class UpdateRoleDto {
	@IsString()
	@IsOptional()
	name?: string;

	@IsNumber()
	@IsOptional()
	permissions?: number;
}

export class AssignRoleDto {
	@IsUUID()
	userId: string;

	@IsUUID()
	roleId: string;
}
