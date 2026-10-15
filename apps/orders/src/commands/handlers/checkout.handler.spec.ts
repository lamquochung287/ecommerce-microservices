// Mock manager/outbox trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
// CartService kéo @lib/cached -> @nestjs/terminus (ESM-only) mà jest CJS không nạp được; spec chỉ cần token DI.
jest.mock('../../cart/cart.service', () => ({
	CartService: class CartService {},
}));

import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { CartService } from '../../cart/cart.service';
import { InventoryClient } from '../../clients/inventory.client';
import { PaymentClient } from '../../clients/payment.client';
import { PromotionClient } from '../../clients/promotion.client';
import { OrderStatus } from '../../entities/order.entity';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { OrderVersionConflictError } from '../../order-state/order-version-conflict.error';
import { OrderPricingService } from '../../pricing/order-pricing.service';
import { CheckoutCommand } from '../checkout.command';
import { CheckoutHandler } from './checkout.handler';

const USER = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EXPIRES = '2030-01-01T00:15:00.000Z';

const address = {
	recipientName: 'An',
	recipientPhone: '0900000000',
	addressLine1: '1 Le Loi',
	city: 'HCM',
	country: 'VN',
};

function setup(
	opts: {
		cartItems?: { productId: string; quantity: number }[];
		replaceRows?: { id: string }[];
		env?: Record<string, unknown>;
		voucherDiscount?: number;
	} = {},
) {
	const manager = {
		create: jest.fn((_entity: unknown, data: Record<string, any>) => ({
			...data,
		})),
		save: jest.fn((entity: unknown) => Promise.resolve(entity)),
		findOne: jest.fn(),
	};
	const dataSource = {
		query: jest.fn().mockResolvedValue(opts.replaceRows ?? []),
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const cartApi = {
		getCart: jest.fn().mockResolvedValue({
			userId: USER,
			items: opts.cartItems ?? [
				{ productId: A, quantity: 2 },
				{ productId: B, quantity: 1 },
				{ productId: C, quantity: 5 },
			],
		}),
	};
	const discount = opts.voucherDiscount ?? 25000;
	const promotion = {
		validate: jest
			.fn()
			.mockResolvedValue({ code: 'SALE10', discountAmount: discount }),
		reserve: jest
			.fn()
			.mockResolvedValue({ code: 'SALE10', discountAmount: discount }),
		release: jest.fn().mockResolvedValue({ released: true }),
	};
	const priceOf: Record<string, number> = { [A]: 100000, [B]: 50000, [C]: 1 };
	const pricing = new OrderPricingService(
		{
			getProduct: jest.fn((id: string) =>
				priceOf[id] === undefined
					? Promise.reject(
							new RpcException({
								statusCode: 404,
								message: 'Product not found',
							}),
						)
					: Promise.resolve({ id, price: String(priceOf[id]), isActive: true }),
			),
		} as never,
		promotion as unknown as PromotionClient,
		{
			get: (key: string) =>
				({ ORDER_TAX_RATE: '0.1', ORDER_SHIPPING_FEE_FLAT: '30000' })[key],
		} as unknown as ConfigService,
	);
	const inventory = {
		reserve: jest.fn().mockResolvedValue({
			orderId: 'x',
			status: 'RESERVED',
			expiresAt: EXPIRES,
		}),
		checkReservation: jest.fn().mockResolvedValue({
			valid: true,
			status: 'RESERVED',
			expiresAt: EXPIRES,
		}),
		release: jest.fn().mockResolvedValue({ released: true }),
	};
	const payment = {
		createIntent: jest.fn().mockResolvedValue({
			intentId: 'intent-1',
			status: 'PENDING',
			checkoutUrl: 'http://pay/simulator/pay/intent-1',
			expiresAt: EXPIRES,
		}),
	};
	const append = jest.fn().mockResolvedValue('evt');
	const transition = jest.fn().mockResolvedValue({});
	const updateWithVersion = jest.fn().mockResolvedValue({});
	const orderTransition = {
		transition,
		updateWithVersion,
	} as unknown as OrderTransitionService;
	const cancellation = new OrderCancellationService(orderTransition);
	const config = {
		get: (key: string, fallback?: unknown) => (opts.env ?? {})[key] ?? fallback,
	} as unknown as ConfigService;

	const handler = new CheckoutHandler(
		dataSource as unknown as DataSource,
		config,
		cartApi as unknown as CartService,
		pricing,
		inventory as unknown as InventoryClient,
		payment as unknown as PaymentClient,
		promotion as unknown as PromotionClient,
		{ append } as unknown as OutboxWriter,
		orderTransition,
		cancellation,
	);
	return {
		handler,
		manager,
		dataSource,
		cartApi,
		inventory,
		payment,
		promotion,
		append,
		transition,
		updateWithVersion,
	};
}

const run = (
	handler: CheckoutHandler,
	items: Record<string, unknown>[],
	extra: Record<string, unknown> = {},
) =>
	handler.execute(
		new CheckoutCommand(USER, {
			items,
			shippingAddress: address,
			...extra,
		} as never),
	);

const statusOf = (error: unknown) =>
	((error as RpcException).getError() as { statusCode: number }).statusCode;

describe('CheckoutHandler', () => {
	it('chọn 2/3 món: reserve đúng 2 món với qty từ cart, giá từ Product, OrderCreated cùng TX, intent theo hạn giữ hàng, không đụng cart', async () => {
		const ctx = setup({ env: { PUBLIC_API_BASE_URL: 'https://shop.test/' } });

		const result = await run(ctx.handler, [{ productId: A }, { productId: B }]);

		const reserve = ctx.inventory.reserve.mock.calls[0][0];
		expect(reserve.items).toEqual([
			{ productId: A, quantity: 2 },
			{ productId: B, quantity: 1 },
		]);
		expect(reserve.ttlSeconds).toBe(900);
		expect(reserve.replaces).toEqual([]);
		expect(reserve.orderId).toBe(result.orderId);

		const created = ctx.manager.create.mock.calls[0][1];
		expect(created).toMatchObject({
			id: result.orderId,
			userId: USER,
			status: OrderStatus.PENDING_PAYMENT,
			version: 1,
			subtotal: 250000,
			taxAmount: 25000,
			shippingFee: 30000,
			discountAmount: 0,
			totalAmount: 305000,
		});
		expect(created.expiresAt).toEqual(new Date(EXPIRES));
		expect(
			created.items.map((i: any) => [i.productId, i.quantity, i.unitPrice]),
		).toEqual([
			[A, 2, 100000],
			[B, 1, 50000],
		]);

		expect(ctx.append).toHaveBeenCalledTimes(1);
		expect(ctx.append.mock.calls[0][0]).toBe(ctx.manager);
		expect(ctx.append.mock.calls[0][1]).toMatchObject({
			topic: KAFKA_TOPIC.ORDER_EVENTS,
			type: MESSAGE_TYPE.ORDER_CREATED,
			orderId: result.orderId,
			payload: { userId: USER, totalAmount: 305000, expiresAt: EXPIRES },
		});

		expect(ctx.payment.createIntent).toHaveBeenCalledWith({
			orderId: result.orderId,
			amount: 305000,
			idempotencyKey: result.orderId,
			expiresAt: EXPIRES,
		});
		expect(ctx.updateWithVersion.mock.calls[0][2]).toEqual({
			paymentIntentId: 'intent-1',
			paymentCheckoutUrl: 'http://pay/simulator/pay/intent-1',
		});

		expect(result).toEqual({
			orderId: result.orderId,
			status: 'PENDING_PAYMENT',
			payment_url: `https://shop.test/orders/${result.orderId}/pay`,
			expiresAt: EXPIRES,
		});
		// CartService chỉ có getCart: set/del/clear sẽ ném nếu bị gọi.
		expect(ctx.cartApi.getCart).toHaveBeenCalledWith(USER);
		expect(Object.keys(ctx.cartApi)).toEqual(['getCart']);
	});

	it('món không có trong cart -> 400, không gọi Inventory', async () => {
		const ctx = setup({ cartItems: [{ productId: A, quantity: 1 }] });
		const error = await run(ctx.handler, [{ productId: B }]).catch((e) => e);
		expect(statusOf(error)).toBe(400);
		expect(ctx.inventory.reserve).not.toHaveBeenCalled();
	});

	it.each([
		['items rỗng', []],
		['trùng productId', [{ productId: A }, { productId: A }]],
		['có variantId', [{ productId: A, variantId: B }]],
		['productId không phải UUID', [{ productId: 'abc' }]],
	])('%s -> 400, không gọi Inventory', async (_name, items) => {
		const ctx = setup();
		const error = await run(ctx.handler, items as never).catch((e) => e);
		expect(statusOf(error)).toBe(400);
		expect(ctx.inventory.reserve).not.toHaveBeenCalled();
	});

	it('thiếu shippingAddress -> 400', async () => {
		const ctx = setup();
		const error = await ctx.handler
			.execute(
				new CheckoutCommand(USER, { items: [{ productId: A }] } as never),
			)
			.catch((e) => e);
		expect(statusOf(error)).toBe(400);
	});

	it('item kèm quantity:999, unitPrice:1 -> bỏ qua, dùng qty cart + giá Product', async () => {
		const ctx = setup();
		await run(ctx.handler, [{ productId: A, quantity: 999, unitPrice: 1 }], {
			userId: 'attacker',
		});

		expect(ctx.inventory.reserve.mock.calls[0][0].items).toEqual([
			{ productId: A, quantity: 2 },
		]);
		const created = ctx.manager.create.mock.calls[0][1];
		expect(created.userId).toBe(USER);
		expect(created.items[0]).toMatchObject({ quantity: 2, unitPrice: 100000 });
	});

	it('Product không tồn tại -> 400, không reserve', async () => {
		const unknown = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
		const ctx = setup({ cartItems: [{ productId: unknown, quantity: 1 }] });
		const error = await run(ctx.handler, [{ productId: unknown }]).catch(
			(e) => e,
		);
		expect(statusOf(error)).toBe(400);
		expect(ctx.inventory.reserve).not.toHaveBeenCalled();
	});

	it('Inventory 409 -> 409, không insert order', async () => {
		const ctx = setup();
		ctx.inventory.reserve.mockRejectedValue(
			new RpcException({ statusCode: 409, message: 'Không đủ tồn kho' }),
		);
		const error = await run(ctx.handler, [{ productId: A }]).catch((e) => e);
		expect(statusOf(error)).toBe(409);
		expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
		expect(ctx.manager.save).not.toHaveBeenCalled();
		expect(ctx.payment.createIntent).not.toHaveBeenCalled();
	});

	it('đơn chờ trùng món: replaces=[cũ]; cũ CANCELLED(REPLACED) + CancelPaymentIntent + OrderCancelled trong cùng TX, không ReleaseInventory', async () => {
		const ctx = setup({ replaceRows: [{ id: OLD }] });
		const old = {
			id: OLD,
			userId: USER,
			status: OrderStatus.PENDING_PAYMENT,
			version: 4,
		};
		ctx.manager.findOne.mockResolvedValue(old);

		await run(ctx.handler, [
			{ productId: A },
			{ productId: B },
			{ productId: C },
		]);

		// 1 query join order_items theo user + danh sách productId
		expect(ctx.dataSource.query).toHaveBeenCalledTimes(1);
		const [sql, params] = ctx.dataSource.query.mock.calls[0];
		expect(sql).toContain('order_items');
		expect(params).toEqual([USER, OrderStatus.PENDING_PAYMENT, [A, B, C]]);
		expect(ctx.inventory.reserve.mock.calls[0][0].replaces).toEqual([OLD]);

		expect(ctx.transition).toHaveBeenCalledTimes(1);
		const [manager, input] = ctx.transition.mock.calls[0];
		expect(manager).toBe(ctx.manager);
		expect(input.order).toBe(old);
		expect(input.to).toBe(OrderStatus.CANCELLED);
		expect(input.patch).toEqual({ cancelReason: 'REPLACED' });
		expect(input.messages.map((m: any) => m.type)).toEqual([
			MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
			MESSAGE_TYPE.ORDER_CANCELLED,
		]);
		expect(input.messages[1].payload).toMatchObject({
			paid: false,
			cancelReason: 'REPLACED',
		});
		// cùng manager với OrderCreated của đơn mới
		expect(ctx.append.mock.calls[0][0]).toBe(ctx.manager);
	});

	it('đơn chờ không trùng món: replaces rỗng, không đơn nào bị huỷ', async () => {
		const ctx = setup({ replaceRows: [] });
		await run(ctx.handler, [{ productId: C }]);
		expect(ctx.inventory.reserve.mock.calls[0][0].replaces).toEqual([]);
		expect(ctx.transition).not.toHaveBeenCalled();
	});

	it('đơn cũ đã đổi trạng thái giữa chừng (findOne null hoặc lệch version) -> bỏ qua, đơn mới vẫn tạo', async () => {
		const gone = setup({ replaceRows: [{ id: OLD }] });
		gone.manager.findOne.mockResolvedValue(null);
		await expect(run(gone.handler, [{ productId: A }])).resolves.toMatchObject({
			status: 'PENDING_PAYMENT',
		});
		expect(gone.transition).not.toHaveBeenCalled();

		const raced = setup({ replaceRows: [{ id: OLD }] });
		raced.manager.findOne.mockResolvedValue({
			id: OLD,
			userId: USER,
			status: OrderStatus.PENDING_PAYMENT,
			version: 1,
		});
		raced.transition.mockRejectedValue(new OrderVersionConflictError(OLD));
		await expect(run(raced.handler, [{ productId: A }])).resolves.toMatchObject(
			{
				status: 'PENDING_PAYMENT',
			},
		);
		expect(raced.manager.save).toHaveBeenCalledTimes(1);
		expect(raced.payment.createIntent).toHaveBeenCalled();
	});

	it('lỗi khác khi huỷ đơn cũ làm hỏng TX và release đơn mới', async () => {
		const ctx = setup({ replaceRows: [{ id: OLD }] });
		ctx.manager.findOne.mockResolvedValue({
			id: OLD,
			userId: USER,
			status: OrderStatus.PENDING_PAYMENT,
			version: 1,
		});
		const boom = new Error('db down');
		ctx.transition.mockRejectedValue(boom);
		await expect(run(ctx.handler, [{ productId: A }])).rejects.toBe(boom);
		expect(ctx.inventory.release).toHaveBeenCalledTimes(1);
	});

	it('TX tạo đơn lỗi -> RELEASE(orderId) best-effort, ném lỗi gốc; release lỗi không che lỗi gốc', async () => {
		const ctx = setup();
		const boom = new Error('insert failed');
		ctx.manager.save.mockRejectedValue(boom);
		ctx.inventory.release.mockRejectedValue(new Error('inventory down'));

		await expect(run(ctx.handler, [{ productId: A }])).rejects.toBe(boom);

		const orderId = ctx.inventory.reserve.mock.calls[0][0].orderId;
		expect(ctx.inventory.release).toHaveBeenCalledWith(orderId);
		expect(ctx.inventory.checkReservation).not.toHaveBeenCalled();
		expect(ctx.payment.createIntent).not.toHaveBeenCalled();
	});

	it('chốt #1 invalid -> CANCELLED(RESERVATION_INVALID) + ReleaseInventory, 409, không tạo intent', async () => {
		const ctx = setup();
		ctx.inventory.checkReservation.mockResolvedValue({
			valid: false,
			status: 'EXPIRED',
			expiresAt: EXPIRES,
		});

		const error = await run(ctx.handler, [{ productId: A }]).catch((e) => e);

		expect(statusOf(error)).toBe(409);
		expect(ctx.payment.createIntent).not.toHaveBeenCalled();
		const [, input] = ctx.transition.mock.calls[0];
		expect(input.to).toBe(OrderStatus.CANCELLED);
		expect(input.patch).toEqual({ cancelReason: 'RESERVATION_INVALID' });
		expect(input.messages.map((m: any) => m.type)).toEqual([
			MESSAGE_TYPE.RELEASE_INVENTORY,
			MESSAGE_TYPE.CANCEL_PAYMENT_INTENT,
			MESSAGE_TYPE.ORDER_CANCELLED,
		]);
	});

	it('CREATE_INTENT timeout -> vẫn trả PENDING_PAYMENT + payment_url, không cập nhật intent', async () => {
		const ctx = setup();
		ctx.payment.createIntent.mockRejectedValue(
			new Error('Timeout has occurred'),
		);

		const result = await run(ctx.handler, [{ productId: A }]);

		expect(result.status).toBe('PENDING_PAYMENT');
		expect(result.payment_url).toMatch(/\/orders\/.+\/pay$/);
		expect(ctx.updateWithVersion).not.toHaveBeenCalled();
		expect(ctx.transition).not.toHaveBeenCalled();
	});

	it('TTL đọc từ ORDER_PAYMENT_TTL_SECONDS', async () => {
		const ctx = setup({ env: { ORDER_PAYMENT_TTL_SECONDS: '120' } });
		await run(ctx.handler, [{ productId: A }]);
		expect(ctx.inventory.reserve.mock.calls[0][0].ttlSeconds).toBe(120);
	});

	describe('voucher', () => {
		it('discount lưu lên Order, total trừ discount, intent theo total; RESERVE_VOUCHER gọi SAU Inventory.RESERVE với orderValue = subtotal', async () => {
			const ctx = setup();

			const result = await run(
				ctx.handler,
				[{ productId: A }, { productId: B }],
				{ voucherCode: ' SALE10 ' },
			);

			expect(ctx.promotion.validate).toHaveBeenCalledWith('SALE10', 250000);
			expect(ctx.promotion.reserve).toHaveBeenCalledWith({
				code: 'SALE10',
				orderId: result.orderId,
				userId: USER,
				orderValue: 250000,
			});
			expect(ctx.inventory.reserve.mock.invocationCallOrder[0]).toBeLessThan(
				ctx.promotion.reserve.mock.invocationCallOrder[0],
			);
			expect(ctx.promotion.reserve.mock.invocationCallOrder[0]).toBeLessThan(
				ctx.manager.save.mock.invocationCallOrder[0],
			);

			const created = ctx.manager.create.mock.calls[0][1];
			expect(created).toMatchObject({
				voucherCode: 'SALE10',
				subtotal: 250000,
				taxAmount: 25000,
				shippingFee: 30000,
				discountAmount: 25000,
				totalAmount: 280000, // 250000 + 25000 + 30000 - 25000
			});
			expect(ctx.payment.createIntent.mock.calls[0][0].amount).toBe(280000);
			expect(ctx.promotion.release).not.toHaveBeenCalled();
		});

		it('không voucher: không gọi Promotion, voucherCode null', async () => {
			const ctx = setup();
			await run(ctx.handler, [{ productId: A }]);
			expect(ctx.promotion.validate).not.toHaveBeenCalled();
			expect(ctx.promotion.reserve).not.toHaveBeenCalled();
			expect(ctx.manager.create.mock.calls[0][1].voucherCode).toBeNull();
		});

		it('validate lỗi 400 -> ném lỗi gốc, chưa reserve kho', async () => {
			const ctx = setup();
			ctx.promotion.validate.mockRejectedValue(
				new RpcException({ statusCode: 400, message: 'Voucher hết hạn' }),
			);
			const error = await run(ctx.handler, [{ productId: A }], {
				voucherCode: 'SALE10',
			}).catch((e) => e);
			expect(statusOf(error)).toBe(400);
			expect(ctx.inventory.reserve).not.toHaveBeenCalled();
		});

		it('RESERVE_VOUCHER lỗi (hết lượt) -> Inventory.RELEASE(orderId), ném lỗi gốc 400, không tạo đơn', async () => {
			const ctx = setup();
			ctx.promotion.reserve.mockRejectedValue(
				new RpcException({ statusCode: 400, message: 'Voucher đã hết lượt' }),
			);

			const error = await run(ctx.handler, [{ productId: A }], {
				voucherCode: 'SALE10',
			}).catch((e) => e);

			expect(statusOf(error)).toBe(400);
			const orderId = ctx.inventory.reserve.mock.calls[0][0].orderId;
			expect(ctx.inventory.release).toHaveBeenCalledWith(orderId);
			expect(ctx.dataSource.transaction).not.toHaveBeenCalled();
			expect(ctx.promotion.release).not.toHaveBeenCalled();
			expect(ctx.payment.createIntent).not.toHaveBeenCalled();
		});

		it('RESERVE_VOUCHER lỗi và Inventory.RELEASE cũng lỗi -> vẫn ném lỗi gốc của voucher', async () => {
			const ctx = setup();
			const voucherError = new RpcException({
				statusCode: 404,
				message: 'Voucher không tồn tại',
			});
			ctx.promotion.reserve.mockRejectedValue(voucherError);
			ctx.inventory.release.mockRejectedValue(new Error('inventory down'));
			await expect(
				run(ctx.handler, [{ productId: A }], { voucherCode: 'SALE10' }),
			).rejects.toBe(voucherError);
		});

		it('TX tạo đơn lỗi -> release cả Inventory và Voucher (best-effort), ném lỗi gốc', async () => {
			const ctx = setup();
			const boom = new Error('insert failed');
			ctx.manager.save.mockRejectedValue(boom);
			ctx.promotion.release.mockRejectedValue(new Error('promotion down'));

			await expect(
				run(ctx.handler, [{ productId: A }], { voucherCode: 'SALE10' }),
			).rejects.toBe(boom);

			const orderId = ctx.inventory.reserve.mock.calls[0][0].orderId;
			expect(ctx.inventory.release).toHaveBeenCalledWith(orderId);
			expect(ctx.promotion.release).toHaveBeenCalledWith(orderId);
		});

		it('TX tạo đơn lỗi, không voucher -> không gọi Promotion.release', async () => {
			const ctx = setup();
			ctx.manager.save.mockRejectedValue(new Error('insert failed'));
			await run(ctx.handler, [{ productId: A }]).catch(() => undefined);
			expect(ctx.promotion.release).not.toHaveBeenCalled();
		});

		it('thay thế đơn cũ có voucher -> OrderCancelled{paid:false, voucherCode} của đơn cũ', async () => {
			const ctx = setup({ replaceRows: [{ id: OLD }] });
			ctx.manager.findOne.mockResolvedValue({
				id: OLD,
				userId: USER,
				status: OrderStatus.PENDING_PAYMENT,
				version: 2,
				voucherCode: 'OLDCODE',
			});

			await run(ctx.handler, [{ productId: A }], { voucherCode: 'SALE10' });

			const [, input] = ctx.transition.mock.calls[0];
			const cancelled = input.messages.find(
				(m: any) => m.type === MESSAGE_TYPE.ORDER_CANCELLED,
			);
			expect(cancelled.payload).toEqual({
				userId: USER,
				paid: false,
				cancelReason: 'REPLACED',
				voucherCode: 'OLDCODE',
			});
		});

		it('chốt #1 invalid với đơn có voucher -> OrderCancelled{paid:false, voucherCode} để trả lượt', async () => {
			const ctx = setup();
			ctx.inventory.checkReservation.mockResolvedValue({
				valid: false,
				status: 'EXPIRED',
				expiresAt: EXPIRES,
			});
			await run(ctx.handler, [{ productId: A }], {
				voucherCode: 'SALE10',
			}).catch(() => undefined);
			const [, input] = ctx.transition.mock.calls[0];
			const cancelled = input.messages.find(
				(m: any) => m.type === MESSAGE_TYPE.ORDER_CANCELLED,
			);
			expect(cancelled.payload).toMatchObject({
				paid: false,
				voucherCode: 'SALE10',
			});
		});
	});
});
