import 'dotenv/config';
import { DataSource } from 'typeorm';
import { AddressService } from './address.service';
import { Address } from '../entities/address.entity';
import { User } from '../entities/user.entity';

const dataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 5432,
	username: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'password',
	database: process.env.DB_NAME || 'ecommerce',
	entities: [Address, User],
	synchronize: false,
});

const baseAddress = {
	recipientName: 'Test',
	recipientPhone: '0900000000',
	addressLine1: '1 Test St',
	city: 'HCMC',
	country: 'VN',
};

describe('AddressService default address exclusivity', () => {
	let addressService: AddressService;
	let testUser: User;

	beforeAll(async () => {
		await dataSource.initialize();
		addressService = new AddressService(
			dataSource.getRepository(Address),
			dataSource.getRepository(User),
			dataSource,
		);

		testUser = await dataSource.getRepository(User).save({
			email: `address-test-${Date.now()}@test.com`,
			password: 'hashed',
		});
	});

	afterAll(async () => {
		await dataSource
			.getRepository(Address)
			.delete({ user: { id: testUser.id } });
		await dataSource.getRepository(User).delete({ id: testUser.id });
		await dataSource.destroy();
	});

	it('set default address mới -> address cũ tự động isDefault = false', async () => {
		const first = await addressService.createAddress({
			...baseAddress,
			userId: testUser.userId,
			isDefault: true,
		});
		expect(first.isDefault).toBe(true);

		const second = await addressService.createAddress({
			...baseAddress,
			userId: testUser.userId,
			isDefault: true,
		});
		expect(second.isDefault).toBe(true);

		const addresses = await addressService.getAddresses(testUser.userId);
		const firstReloaded = addresses.find((a) => a.id === first.id)!;
		expect(firstReloaded.isDefault).toBe(false); // bị unset khi second được tạo làm default

		const defaultCount = addresses.filter((a) => a.isDefault).length;
		expect(defaultCount).toBe(1);
	});

	it('setDefaultAddress chuyển default sang address chỉ định, unset address khác', async () => {
		const a1 = await addressService.createAddress({
			...baseAddress,
			userId: testUser.userId,
		});
		const a2 = await addressService.createAddress({
			...baseAddress,
			userId: testUser.userId,
			isDefault: true,
		});

		await addressService.setDefaultAddress(a1.id);

		const addresses = await addressService.getAddresses(testUser.userId);
		const a1Reloaded = addresses.find((a) => a.id === a1.id)!;
		const a2Reloaded = addresses.find((a) => a.id === a2.id)!;

		expect(a1Reloaded.isDefault).toBe(true);
		expect(a2Reloaded.isDefault).toBe(false);
		expect(addresses.filter((a) => a.isDefault).length).toBe(1);
	});
});
