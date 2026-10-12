import 'dotenv/config';
import { DataSource } from 'typeorm';
import { RoleService } from './role.service';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { User } from '../entities/user.entity';
import { Action, ModuleName } from 'libs/constant/permission.constant';

const dataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 5432,
	username: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'password',
	database: process.env.DB_NAME || 'ecommerce',
	entities: [Role, UserRole, User],
	synchronize: false,
});

describe('RoleService.getEffectivePermissions', () => {
	let roleService: RoleService;
	let testUser: User;

	beforeAll(async () => {
		await dataSource.initialize();
		roleService = new RoleService(
			dataSource.getRepository(Role),
			dataSource.getRepository(UserRole),
			dataSource.getRepository(User),
		);

		testUser = await dataSource.getRepository(User).save({
			email: `rbac-test-${Date.now()}@test.com`,
			password: 'hashed',
			permissions: 0,
		});
	});

	afterAll(async () => {
		await dataSource
			.getRepository(UserRole)
			.delete({ user: { id: testUser.id } });
		await dataSource.getRepository(User).delete({ id: testUser.id });
		await dataSource.destroy();
	});

	it('trả về null khi user chưa có role nào (để fallback field permissions cũ)', async () => {
		const result = await roleService.getEffectivePermissions(testUser.id);
		expect(result).toBeNull();
	});

	it('OR đúng bitmask permissions của tất cả role user đang có', async () => {
		const readOnlyRole = await roleService.createRole({
			name: `Reader-${Date.now()}`,
			permissions: ModuleName.PRODUCT | Action.READ,
		});
		const writeRole = await roleService.createRole({
			name: `Writer-${Date.now()}`,
			permissions: ModuleName.ORDER | Action.CREATE,
		});

		await roleService.assignRole({
			userId: testUser.userId,
			roleId: readOnlyRole.id,
		});
		await roleService.assignRole({
			userId: testUser.userId,
			roleId: writeRole.id,
		});

		const effective = await roleService.getEffectivePermissions(testUser.id);
		const expected =
			ModuleName.PRODUCT | Action.READ | (ModuleName.ORDER | Action.CREATE);
		expect(effective).toBe(expected);

		// Verify từng quyền riêng lẻ đều pass check bitmask
		expect(effective! & (ModuleName.PRODUCT | Action.READ)).toBe(
			ModuleName.PRODUCT | Action.READ,
		);
		expect(effective! & (ModuleName.ORDER | Action.CREATE)).toBe(
			ModuleName.ORDER | Action.CREATE,
		);

		await roleService.deleteRole(readOnlyRole.id);
		await roleService.deleteRole(writeRole.id);
	});
});
