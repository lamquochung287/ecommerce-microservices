import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
	createMockDataSource,
	createMockManager,
} from '../../../test/mock-manager';
import {
	GetAvailabilityDto,
	MAX_AVAILABILITY_IDS,
} from '../../dto/inventory.dto';
import { GetAvailabilityQuery } from '../get-availability.query';
import { GetAvailabilityHandler } from './get-availability.handler';

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('GetAvailabilityHandler', () => {
	it('available = onHand - reserved do DB tính; thiếu dòng kho -> 0; giữ thứ tự và khử trùng', async () => {
		const { manager, calls } = createMockManager([
			[/FROM "stock_items"/, () => [{ productId: P1, available: 7 }]],
		]);
		const handler = new GetAvailabilityHandler(
			createMockDataSource(manager) as never,
		);

		const result = await handler.execute(
			new GetAvailabilityQuery([P2, P1, P2]),
		);

		expect(result).toEqual([
			{ productId: P2, available: 0 },
			{ productId: P1, available: 7 },
		]);
		expect(calls[0].sql).toMatch(/"variantId" IS NULL/);
		expect(calls[0].params).toEqual([[P2, P1]]);
	});

	it('danh sách rỗng: không query', async () => {
		const { manager, query } = createMockManager([]);
		const handler = new GetAvailabilityHandler(
			createMockDataSource(manager) as never,
		);

		await expect(
			handler.execute(new GetAvailabilityQuery([])),
		).resolves.toEqual([]);
		expect(query).not.toHaveBeenCalled();
	});
});

describe('GetAvailabilityDto', () => {
	const validateIds = (productIds: unknown) =>
		validate(plainToInstance(GetAvailabilityDto, { productIds }));

	it('cho phép đúng giới hạn 200 id', async () => {
		const ids = Array.from({ length: MAX_AVAILABILITY_IDS }, () => P1);
		expect(await validateIds(ids)).toHaveLength(0);
	});

	it('>200 id: lỗi validate', async () => {
		const ids = Array.from({ length: MAX_AVAILABILITY_IDS + 1 }, () => P1);
		expect(await validateIds(ids)).not.toHaveLength(0);
	});

	it('id không phải UUID: lỗi validate', async () => {
		expect(await validateIds(['not-a-uuid'])).not.toHaveLength(0);
	});

	it('không phải mảng: lỗi validate', async () => {
		expect(await validateIds(P1)).not.toHaveLength(0);
	});
});
