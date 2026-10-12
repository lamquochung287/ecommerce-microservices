import {
	Injectable,
	ConflictException,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './role.dto';

@Injectable()
export class RoleService {
	constructor(
		@InjectRepository(Role) private readonly roleRepository: Repository<Role>,
		@InjectRepository(UserRole)
		private readonly userRoleRepository: Repository<UserRole>,
		@InjectRepository(User) private readonly userRepository: Repository<User>,
	) {}

	async createRole(dto: CreateRoleDto): Promise<Role> {
		const existing = await this.roleRepository.findOne({
			where: { name: dto.name },
		});
		if (existing) {
			throw new ConflictException('Role already exists');
		}
		const role = this.roleRepository.create(dto);
		return this.roleRepository.save(role);
	}

	async getRoles(): Promise<Role[]> {
		return this.roleRepository.find({ order: { name: 'ASC' } });
	}

	async updateRole(id: string, dto: UpdateRoleDto): Promise<Role> {
		const role = await this.roleRepository.findOne({ where: { id } });
		if (!role) {
			throw new NotFoundException('Role not found');
		}
		Object.assign(role, dto);
		return this.roleRepository.save(role);
	}

	async deleteRole(id: string): Promise<{ success: boolean; message: string }> {
		const role = await this.roleRepository.findOne({ where: { id } });
		if (!role) {
			throw new NotFoundException('Role not found');
		}
		await this.roleRepository.remove(role);
		return { success: true, message: 'Role deleted successfully' };
	}

	async assignRole(dto: AssignRoleDto): Promise<UserRole> {
		const user = await this.userRepository.findOne({
			where: { userId: dto.userId },
		});
		if (!user) {
			throw new NotFoundException('User not found');
		}
		const role = await this.roleRepository.findOne({
			where: { id: dto.roleId },
		});
		if (!role) {
			throw new NotFoundException('Role not found');
		}

		const existing = await this.userRoleRepository.findOne({
			where: { user: { id: user.id }, role: { id: role.id } },
		});
		if (existing) {
			return existing;
		}

		const userRole = this.userRoleRepository.create({ user, role });
		return this.userRoleRepository.save(userRole);
	}

	async removeRole(
		dto: AssignRoleDto,
	): Promise<{ success: boolean; message: string }> {
		const user = await this.userRepository.findOne({
			where: { userId: dto.userId },
		});
		if (!user) {
			throw new NotFoundException('User not found');
		}
		const userRole = await this.userRoleRepository.findOne({
			where: { user: { id: user.id }, role: { id: dto.roleId } },
		});
		if (!userRole) {
			throw new NotFoundException('User does not have this role');
		}
		await this.userRoleRepository.remove(userRole);
		return { success: true, message: 'Role removed successfully' };
	}

	// OR tất cả bitmask permissions của các role user đang có. Trả về null nếu user chưa có role nào (fallback field cũ).
	async getEffectivePermissions(userDbId: number): Promise<number | null> {
		const userRoles = await this.userRoleRepository.find({
			where: { user: { id: userDbId } },
			relations: ['role'],
		});
		if (userRoles.length === 0) {
			return null;
		}
		return userRoles.reduce((acc, ur) => acc | Number(ur.role.permissions), 0);
	}
}
