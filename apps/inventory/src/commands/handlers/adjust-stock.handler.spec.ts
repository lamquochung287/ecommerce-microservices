import { RpcException } from '@nestjs/microservices';
import {
	createMockDataSource,
	createMockManager,
} from '../../../test/mock-manager';
import { AdjustStockCommand } from '../adjust-stock.command';
import { AdjustStockHandler } from './adjust-stock.handler';

const PRODUCT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELECT_ROW = /FOR UPDATE/;

function setup(row: { onHand: number; reserved: number }) {
	const mock = createMockManager([
		[
			SELECT_ROW,
			() => [{ id: 's1', productId: PRODUCT, variantId: null, ...row }],
		],
	]);
	const handler = new AdjustStockHandler(
		createMockDataSource(mock.manager) as never,
	);
	return { handler, ...mock };
}

describe('AdjustStockHandler', () => {
	it('upsert dòng kho rồi cộng delta', async () => {
		const { handler, calls } = setup({ onHand: 5, reserved: 2 });

		const result = await handler.execute(
			new AdjustStockCommand({ productId: PRODUCT, delta: 10 }),
		);

		expect(calls[0].sql).toMatch(
			/INSERT INTO "stock_items"[\s\S]*ON CONFLICT DO NOTHING/,
		);
		expect(calls[0].params).toEqual([PRODUCT, null]);
		const update = calls.find((c) =>
			/UPDATE "stock_items" SET "onHand"/.test(c.sql),
		);
		expect(update?.params).toEqual([15, 's1']);
		expect(result).toEqual({
			productId: PRODUCT,
			variantId: null,
			onHand: 15,
			reserved: 2,
			available: 13,
		});
	});

	it('delta làm onHand < reserved: 409 và không UPDATE', async () => {
		const { handler, calls } = setup({ onHand: 5, reserved: 4 });

		const error = await handler
			.execute(new AdjustStockCommand({ productId: PRODUCT, delta: -2 }))
			.catch((e: RpcException) => e);

		expect(error).toBeInstanceOf(RpcException);
		expect((error as RpcException).getError()).toMatchObject({
			statusCode: 409,
		});
		expect(calls.some((c) => /UPDATE "stock_items"/.test(c.sql))).toBe(false);
	});

	it('delta làm onHand < 0 (dòng mới tạo, giảm): 409', async () => {
		const { handler } = setup({ onHand: 0, reserved: 0 });

		await expect(
			handler.execute(
				new AdjustStockCommand({ productId: PRODUCT, delta: -1 }),
			),
		).rejects.toBeInstanceOf(RpcException);
	});

	it('giảm đúng bằng phần còn khả dụng: cho phép', async () => {
		const { handler } = setup({ onHand: 5, reserved: 4 });

		await expect(
			handler.execute(
				new AdjustStockCommand({ productId: PRODUCT, delta: -1 }),
			),
		).resolves.toMatchObject({ onHand: 4, available: 0 });
	});
});
