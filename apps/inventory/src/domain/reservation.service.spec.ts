import { RpcException } from '@nestjs/microservices';
import { SQL, createMockManager, QueryRoute } from '../../test/mock-manager';
import { ReserveStockDto } from '../dto/inventory.dto';
import { ReservationStatus } from '../entities/reservation.entity';
import {
	ReservationRow,
	ReservationService,
	StockRow,
} from './reservation.service';

const ORDER = '11111111-1111-4111-8111-111111111111';
const OLD_ORDER = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const stock = (
	id: string,
	productId: string,
	onHand: number,
	reserved = 0,
): StockRow => ({ id, productId, variantId: null, onHand, reserved });

const dtoOf = (
	items: { productId: string; quantity: number }[],
	extra: Partial<ReserveStockDto> = {},
): ReserveStockDto => ({
	orderId: ORDER,
	items: items.map((i) => ({ ...i, variantId: null })),
	ttlSeconds: 900,
	...extra,
});

function errorOf(fn: () => Promise<unknown>) {
	return fn().then(
		() => {
			throw new Error('expected rejection');
		},
		(err: unknown) => {
			expect(err).toBeInstanceOf(RpcException);
			return (err as RpcException).getError() as Record<string, unknown>;
		},
	);
}

describe('ReservationService', () => {
	const service = new ReservationService();

	describe('reserve', () => {
		it('đủ hàng: tăng reserved, insert RESERVED với expiresAt = now + ttl', async () => {
			const rows = [stock('s1', P1, 10), stock('s2', P2, 5)];
			const { manager, calls, callsMatching } = createMockManager([
				[SQL.lockStock, () => rows],
			]);
			const before = Date.now();

			const result = await service.reserve(
				manager,
				dtoOf([
					{ productId: P1, quantity: 2 },
					{ productId: P2, quantity: 5 },
				]),
			);

			expect(result.status).toBe(ReservationStatus.RESERVED);
			expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
				before + 900_000,
			);
			expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
				Date.now() + 900_000,
			);
			const updates = callsMatching(SQL.updateStock);
			expect(updates.map((c) => c.params)).toEqual([
				[2, 's1'],
				[5, 's2'],
			]);
			const insert = callsMatching(SQL.insertReservation);
			expect(insert).toHaveLength(1);
			expect(insert[0].params[0]).toBe(ORDER);
			expect(JSON.parse(insert[0].params[1] as string)).toEqual([
				{ productId: P1, variantId: null, quantity: 2 },
				{ productId: P2, variantId: null, quantity: 5 },
			]);
			expect(insert[0].params[3]).toBe(result.expiresAt);
			// khoá kho xong mới ghi
			const firstWrite = calls.findIndex((c) =>
				/^\s*(UPDATE|INSERT)/.test(c.sql),
			);
			const lockIndex = calls.findIndex((c) => SQL.lockStock.test(c.sql));
			expect(lockIndex).toBeLessThan(firstWrite);
		});

		it('gộp cùng (productId, variantId) xuất hiện nhiều lần thành một dòng kho', async () => {
			const { manager, callsMatching } = createMockManager([
				[SQL.lockStock, () => [stock('s1', P1, 10)]],
			]);

			await service.reserve(
				manager,
				dtoOf([
					{ productId: P1, quantity: 2 },
					{ productId: P1, quantity: 3 },
				]),
			);

			expect(callsMatching(SQL.updateStock).map((c) => c.params)).toEqual([
				[5, 's1'],
			]);
		});

		it('item thứ 2 thiếu hàng: 409 kèm productIds và không ghi gì', async () => {
			const { manager, calls } = createMockManager([
				[SQL.lockStock, () => [stock('s1', P1, 10), stock('s2', P2, 1)]],
			]);

			const err = await errorOf(() =>
				service.reserve(
					manager,
					dtoOf([
						{ productId: P1, quantity: 2 },
						{ productId: P2, quantity: 2 },
					]),
				),
			);

			expect(err.statusCode).toBe(409);
			expect(err.productIds).toEqual([P2]);
			expect(
				calls.filter((c) => /^\s*(UPDATE|INSERT)/.test(c.sql)),
			).toHaveLength(0);
		});

		it('tính phần đã giữ (reserved) của đơn khác: onHand 5, reserved 4 -> chỉ còn 1', async () => {
			const { manager } = createMockManager([
				[SQL.lockStock, () => [stock('s1', P1, 5, 4)]],
			]);

			await expect(
				service.reserve(manager, dtoOf([{ productId: P1, quantity: 2 }])),
			).rejects.toBeInstanceOf(RpcException);
		});

		it('thiếu dòng kho -> 409 liệt kê productId', async () => {
			const { manager, callsMatching } = createMockManager([
				[SQL.lockStock, () => [stock('s1', P1, 10)]],
			]);

			const err = await errorOf(() =>
				service.reserve(
					manager,
					dtoOf([
						{ productId: P1, quantity: 1 },
						{ productId: P3, quantity: 1 },
					]),
				),
			);

			expect(err.productIds).toEqual([P3]);
			expect(callsMatching(SQL.insertReservation)).toHaveLength(0);
		});

		it('orderId đã RESERVED: trả lại reservation cũ, không đụng kho', async () => {
			const expiresAt = new Date(Date.now() + 60_000);
			const existing: ReservationRow = {
				id: 'r1',
				orderId: ORDER,
				items: [],
				status: ReservationStatus.RESERVED,
				expiresAt,
			};
			const { manager, calls } = createMockManager([
				[SQL.findReservation, () => [existing]],
			]);

			const result = await service.reserve(
				manager,
				dtoOf([{ productId: P1, quantity: 1 }]),
			);

			expect(result).toEqual({
				orderId: ORDER,
				status: ReservationStatus.RESERVED,
				expiresAt,
			});
			expect(calls.filter((c) => /stock_items/.test(c.sql))).toHaveLength(0);
		});

		it.each([
			ReservationStatus.RELEASED,
			ReservationStatus.EXPIRED,
			ReservationStatus.COMMITTED,
		])('orderId đã %s: 409, không hồi sinh', async (status) => {
			const { manager, callsMatching } = createMockManager([
				[
					SQL.findReservation,
					() => [
						{
							id: 'r1',
							orderId: ORDER,
							items: [],
							status,
							expiresAt: new Date(),
						},
					],
				],
			]);

			const err = await errorOf(() =>
				service.reserve(manager, dtoOf([{ productId: P1, quantity: 1 }])),
			);

			expect(err.statusCode).toBe(409);
			expect(callsMatching(SQL.updateStock)).toHaveLength(0);
			expect(callsMatching(SQL.insertReservation)).toHaveLength(0);
		});

		describe('replaces', () => {
			const oldReservation: ReservationRow = {
				id: 'r-old',
				orderId: OLD_ORDER,
				items: [{ productId: P1, variantId: null, quantity: 1 }],
				status: ReservationStatus.RESERVED,
				expiresAt: new Date(Date.now() + 60_000),
			};

			it('hàng còn 1 và đơn cũ đang giữ đúng món đó: thành công, đơn cũ RELEASED', async () => {
				const { manager, callsMatching } = createMockManager([
					[SQL.replacedReservations, () => [oldReservation]],
					[SQL.lockStock, () => [stock('s1', P1, 1, 1)]],
				]);

				const result = await service.reserve(
					manager,
					dtoOf([{ productId: P1, quantity: 1 }], { replaces: [OLD_ORDER] }),
				);

				expect(result.status).toBe(ReservationStatus.RESERVED);
				// giải phóng -1 và giữ +1 cùng dòng kho => net 0, không cần UPDATE
				expect(callsMatching(SQL.updateStock)).toHaveLength(0);
				const released = callsMatching(SQL.updateReservationStatus);
				expect(released).toHaveLength(1);
				expect(released[0].params).toEqual([
					ReservationStatus.RELEASED,
					['r-old'],
				]);
				expect(callsMatching(SQL.insertReservation)).toHaveLength(1);
			});

			it('khoá kho một câu ORDER BY id và ghi theo id tăng dần', async () => {
				const { manager, callsMatching } = createMockManager([
					[
						SQL.replacedReservations,
						() => [
							{
								...oldReservation,
								items: [{ productId: P3, variantId: null, quantity: 2 }],
							},
						],
					],
					// DB trả theo id tăng dần: s-a (P2) trước s-b (P1) dù item đầu của request là P1
					[
						SQL.lockStock,
						() => [
							stock('s-a', P2, 10),
							stock('s-b', P1, 10),
							stock('s-c', P3, 10, 2),
						],
					],
				]);

				await service.reserve(
					manager,
					dtoOf(
						[
							{ productId: P1, quantity: 1 },
							{ productId: P2, quantity: 1 },
						],
						{ replaces: [OLD_ORDER] },
					),
				);

				const lock = callsMatching(SQL.lockStock);
				expect(lock).toHaveLength(1);
				expect(lock[0].sql).toMatch(/ORDER BY s\."id" FOR UPDATE/);
				expect(lock[0].params[0]).toEqual(expect.arrayContaining([P1, P2, P3]));
				expect(callsMatching(SQL.updateStock).map((c) => c.params)).toEqual([
					[1, 's-a'],
					[1, 's-b'],
					[-2, 's-c'],
				]);
			});

			it('món mới thiếu hàng: 409 và không ghi gì (đơn cũ giữ nguyên phần giữ)', async () => {
				const { manager, calls } = createMockManager([
					[SQL.replacedReservations, () => [oldReservation]],
					[SQL.lockStock, () => [stock('s1', P1, 1, 1), stock('s2', P2, 0)]],
				]);

				await errorOf(() =>
					service.reserve(
						manager,
						dtoOf(
							[
								{ productId: P1, quantity: 1 },
								{ productId: P2, quantity: 1 },
							],
							{ replaces: [OLD_ORDER] },
						),
					),
				);

				expect(
					calls.filter((c) => /^\s*(UPDATE|INSERT)/.test(c.sql)),
				).toHaveLength(0);
			});

			it('bỏ qua chính orderId trong replaces', async () => {
				const { manager, callsMatching } = createMockManager([
					[SQL.lockStock, () => [stock('s1', P1, 5)]],
				]);

				await service.reserve(
					manager,
					dtoOf([{ productId: P1, quantity: 1 }], { replaces: [ORDER] }),
				);

				expect(callsMatching(SQL.replacedReservations)).toHaveLength(0);
			});
		});
	});

	describe('release', () => {
		const reserved: ReservationRow = {
			id: 'r1',
			orderId: ORDER,
			items: [{ productId: P1, variantId: null, quantity: 3 }],
			status: ReservationStatus.RESERVED,
			expiresAt: new Date(),
		};

		it('RESERVED: trả reserved và đổi RELEASED', async () => {
			const { manager, callsMatching } = createMockManager([
				[SQL.findReservation, () => [reserved]],
				[SQL.lockStock, () => [stock('s1', P1, 10, 3)]],
			]);

			await expect(service.release(manager, ORDER)).resolves.toEqual({
				released: true,
			});

			expect(callsMatching(SQL.updateStock)[0].params).toEqual([-3, 's1']);
			expect(callsMatching(SQL.updateReservationStatus)[0].params).toEqual([
				ReservationStatus.RELEASED,
				'r1',
			]);
		});

		it.each([
			[ReservationStatus.RELEASED],
			[ReservationStatus.COMMITTED],
			[ReservationStatus.EXPIRED],
		])('%s: no-op', async (status) => {
			const { manager, calls } = createMockManager([
				[SQL.findReservation, () => [{ ...reserved, status }]],
			]);

			await expect(service.release(manager, ORDER)).resolves.toEqual({
				released: false,
			});
			expect(calls.filter((c) => /^\s*UPDATE/.test(c.sql))).toHaveLength(0);
		});

		it('không có reservation: no-op', async () => {
			const { manager } = createMockManager([]);
			await expect(service.release(manager, ORDER)).resolves.toEqual({
				released: false,
			});
		});
	});

	describe('expireOne', () => {
		it('SKIP LOCKED: không lấy được dòng thì không đổi gì', async () => {
			const { manager, calls } = createMockManager([]);

			await expect(service.expireOne(manager, 'r1', new Date())).resolves.toBe(
				false,
			);

			expect(calls[0].sql).toMatch(/FOR UPDATE SKIP LOCKED/);
			expect(calls.filter((c) => /^\s*UPDATE/.test(c.sql))).toHaveLength(0);
		});

		it('hết hạn: trả reserved và đổi EXPIRED', async () => {
			const { manager, callsMatching } = createMockManager([
				[
					/FOR UPDATE SKIP LOCKED/,
					() => [
						{
							id: 'r1',
							orderId: ORDER,
							items: [{ productId: P1, variantId: null, quantity: 2 }],
							status: ReservationStatus.RESERVED,
							expiresAt: new Date(0),
						},
					],
				],
				[SQL.lockStock, () => [stock('s1', P1, 10, 2)]],
			]);

			await expect(service.expireOne(manager, 'r1', new Date())).resolves.toBe(
				true,
			);

			expect(callsMatching(SQL.updateStock)[0].params).toEqual([-2, 's1']);
			expect(callsMatching(SQL.updateReservationStatus)[0].params).toEqual([
				ReservationStatus.EXPIRED,
				'r1',
			]);
		});
	});

	describe('findExpiredIds', () => {
		it('chỉ lọc RESERVED quá ngưỡng, giới hạn batch', async () => {
			const threshold = new Date();
			const routes: QueryRoute[] = [
				[/SELECT "id" FROM "reservations"/, () => [{ id: 'a' }, { id: 'b' }]],
			];
			const { manager, calls } = createMockManager(routes);

			await expect(
				service.findExpiredIds(manager, threshold, 100),
			).resolves.toEqual(['a', 'b']);

			expect(calls[0].params).toEqual([
				ReservationStatus.RESERVED,
				threshold,
				100,
			]);
		});
	});
});

describe('ReservationService commit/restock', () => {
	const service = new ReservationService();
	const row = (status: ReservationStatus): ReservationRow => ({
		id: 'r1',
		orderId: ORDER,
		items: [
			{ productId: P1, variantId: null, quantity: 2 },
			{ productId: P2, variantId: null, quantity: 3 },
		],
		status,
		expiresAt: new Date(Date.now() - 1000),
	});

	it('commit RESERVED (kể cả quá expiresAt): trừ onHand và reserved theo id tăng dần rồi COMMITTED', async () => {
		const { manager, calls } = createMockManager([
			[SQL.findReservation, () => [row(ReservationStatus.RESERVED)]],
			// id trả theo thứ tự tăng dần, không theo thứ tự item
			[SQL.lockStock, () => [stock('s-a', P2, 10, 3), stock('s-b', P1, 10, 2)]],
		]);

		await expect(service.commit(manager, ORDER)).resolves.toEqual({
			outcome: 'COMMITTED',
		});

		const updates = calls.filter((c) => /UPDATE "stock_items"/.test(c.sql));
		expect(updates.map((c) => c.params)).toEqual([
			[-3, -3, 's-a'],
			[-2, -2, 's-b'],
		]);
		expect(
			calls.find((c) => SQL.updateReservationStatus.test(c.sql))?.params,
		).toEqual([ReservationStatus.COMMITTED, 'r1']);
	});

	it('commit thiếu dòng kho: ném lỗi kỹ thuật, không đổi gì', async () => {
		const { manager, calls } = createMockManager([
			[SQL.findReservation, () => [row(ReservationStatus.RESERVED)]],
			[SQL.lockStock, () => [stock('s-b', P1, 10, 2)]],
		]);

		await expect(service.commit(manager, ORDER)).rejects.toThrow(
			/Dòng kho không tồn tại/,
		);
		expect(calls.some((c) => /^\s*UPDATE/.test(c.sql))).toBe(false);
	});

	it.each([
		[ReservationStatus.RELEASED, 'RESERVATION_RELEASED'],
		[ReservationStatus.EXPIRED, 'RESERVATION_EXPIRED'],
		[ReservationStatus.RESTOCKED, 'RESERVATION_RESTOCKED'],
	])('commit %s: FAILED(%s), kho không đổi', async (status, reason) => {
		const { manager, calls } = createMockManager([
			[SQL.findReservation, () => [row(status)]],
		]);

		await expect(service.commit(manager, ORDER)).resolves.toEqual({
			outcome: 'FAILED',
			reason,
		});
		expect(calls.some((c) => /^\s*UPDATE/.test(c.sql))).toBe(false);
	});

	it('commit không có reservation: FAILED(RESERVATION_NOT_FOUND)', async () => {
		const { manager } = createMockManager([]);
		await expect(service.commit(manager, ORDER)).resolves.toEqual({
			outcome: 'FAILED',
			reason: 'RESERVATION_NOT_FOUND',
		});
	});

	it('restock COMMITTED: cộng lại onHand (reserved giữ nguyên) rồi RESTOCKED', async () => {
		const { manager, calls } = createMockManager([
			[SQL.findReservation, () => [row(ReservationStatus.COMMITTED)]],
			[SQL.lockStock, () => [stock('s-a', P2, 7, 0), stock('s-b', P1, 8, 0)]],
		]);

		await expect(service.restock(manager, ORDER)).resolves.toBe('RESTOCKED');

		expect(
			calls
				.filter((c) => /UPDATE "stock_items"/.test(c.sql))
				.map((c) => c.params),
		).toEqual([
			[3, 0, 's-a'],
			[2, 0, 's-b'],
		]);
		expect(
			calls.find((c) => SQL.updateReservationStatus.test(c.sql))?.params,
		).toEqual([ReservationStatus.RESTOCKED, 'r1']);
	});

	it.each([
		ReservationStatus.RESTOCKED,
		ReservationStatus.RELEASED,
		ReservationStatus.EXPIRED,
	])('restock %s: no-op', async (status) => {
		const { manager, calls } = createMockManager([
			[SQL.findReservation, () => [row(status)]],
		]);

		await expect(service.restock(manager, ORDER)).resolves.toBe('NOOP');
		expect(calls.some((c) => /^\s*UPDATE/.test(c.sql))).toBe(false);
	});

	it('restock RESERVED: chỉ release (trả reserved), không cộng onHand', async () => {
		const { manager, calls } = createMockManager([
			[SQL.findReservation, () => [row(ReservationStatus.RESERVED)]],
			[SQL.lockStock, () => [stock('s-a', P2, 10, 3), stock('s-b', P1, 10, 2)]],
		]);

		await expect(service.restock(manager, ORDER)).resolves.toBe('RELEASED');

		expect(
			calls.filter((c) => SQL.updateStock.test(c.sql)).map((c) => c.params),
		).toEqual([
			[-3, 's-a'],
			[-2, 's-b'],
		]);
		expect(
			calls.find((c) => SQL.updateReservationStatus.test(c.sql))?.params,
		).toEqual([ReservationStatus.RELEASED, 'r1']);
	});
});
