// CachedService/ConfigService giả trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConfigService } from '@nestjs/config';

// @lib/cached kéo @nestjs/terminus (ESM-only) mà jest CJS không nạp được; chỉ cần kiểu nên thay bằng stub.
jest.mock('@lib/cached', () => ({ CachedService: class {} }));

import { CachedService } from '@lib/cached';
import { CartService } from './cart.service';

const USER = 'u-1';

function setup(items: Array<{ productId: string; quantity: number }> | null) {
	const store: { value: string | null } = {
		value:
			items === null
				? null
				: JSON.stringify({ userId: USER, items, updatedAt: 'old' }),
	};
	const cached = {
		get: jest.fn().mockImplementation(() => Promise.resolve(store.value)),
		set: jest.fn().mockImplementation((_k: string, v: string) => {
			store.value = v;
			return Promise.resolve();
		}),
		del: jest.fn(),
	};
	const service = new CartService(
		cached as unknown as CachedService,
		{ get: () => undefined } as unknown as ConfigService,
	);
	const saved = () => JSON.parse(store.value as string);
	return { service, cached, saved };
}

describe('CartService.deductItems', () => {
	it('đặt 2, trong cart 5 thì còn 3; món không thuộc đơn giữ nguyên', async () => {
		const { service, saved } = setup([
			{ productId: 'A', quantity: 5 },
			{ productId: 'D', quantity: 1 },
		]);
		await service.deductItems(USER, [{ productId: 'A', quantity: 2 }]);
		expect(saved().items).toEqual([
			{ productId: 'A', quantity: 3 },
			{ productId: 'D', quantity: 1 },
		]);
	});

	it('số lượng còn lại <= 0 thì xoá dòng', async () => {
		const { service, saved } = setup([
			{ productId: 'A', quantity: 2 },
			{ productId: 'B', quantity: 1 },
			{ productId: 'D', quantity: 4 },
		]);
		// A đúng bằng số đã đặt, B ít hơn số đã đặt (user giảm khi chờ thanh toán).
		await service.deductItems(USER, [
			{ productId: 'A', quantity: 2 },
			{ productId: 'B', quantity: 3 },
		]);
		expect(saved().items).toEqual([{ productId: 'D', quantity: 4 }]);
	});

	it('món user đã tự xoá khỏi cart thì bỏ qua và không ghi lại cart', async () => {
		const { service, cached } = setup([{ productId: 'D', quantity: 1 }]);
		const cart = await service.deductItems(USER, [
			{ productId: 'A', quantity: 2 },
		]);
		expect(cart.items).toEqual([{ productId: 'D', quantity: 1 }]);
		expect(cached.set).not.toHaveBeenCalled();
	});

	it('cart không tồn tại: không tạo cart rỗng', async () => {
		const { service, cached } = setup(null);
		const cart = await service.deductItems(USER, [
			{ productId: 'A', quantity: 2 },
		]);
		expect(cart.items).toEqual([]);
		expect(cached.set).not.toHaveBeenCalled();
	});

	it('trừ nhiều món trong một lần ghi', async () => {
		const { service, cached, saved } = setup([
			{ productId: 'A', quantity: 5 },
			{ productId: 'B', quantity: 2 },
		]);
		await service.deductItems(USER, [
			{ productId: 'A', quantity: 2 },
			{ productId: 'B', quantity: 2 },
		]);
		expect(cached.set).toHaveBeenCalledTimes(1);
		expect(saved().items).toEqual([{ productId: 'A', quantity: 3 }]);
	});
});
