/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
import {
	CanActivate,
	ExecutionContext,
	INestApplication,
	MiddlewareConsumer,
	Module,
	NestModule,
	ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

// @lib/cached kéo @nestjs/terminus (ESM-only) mà jest CJS không nạp được; chỉ cần token kiểu.
jest.mock('@lib/cached', () => ({ CachedService: class CachedService {} }));

import { CachedService } from '@lib/cached';
import { CartController } from './cart.controller';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { IdempotencyInterceptor } from '../common/interceptor/idempotency.interceptor';
import { RequestTrackerMiddleware } from '../common/middleware/request-tracker.middleware';

const API_KEY = 'test-api-key';
const PRODUCT_A = 'a3d1f7a0-5a4b-4c1a-9a53-2f0f3b1d8a01';
const shippingAddress = {
	recipientName: 'An',
	recipientPhone: '0900000000',
	addressLine1: '1 Nguyen Hue',
	city: 'HCM',
	country: 'VN',
};
const validBody = { items: [{ productId: PRODUCT_A }], shippingAddress };

// Guard giả: userId lấy từ header x-test-user (thay cho token thật).
class FakeJwtGuard implements CanActivate {
	canActivate(context: ExecutionContext) {
		const req = context.switchToHttp().getRequest();
		req.user = { userId: req.headers['x-test-user'] ?? 'user-1' };
		return true;
	}
}

describe('CartController checkout (HTTP)', () => {
	let app: INestApplication;
	let ordersService: { checkout: jest.Mock };
	let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
	let store: Map<string, string>;

	beforeEach(async () => {
		store = new Map();
		cache = {
			get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
			set: jest.fn((key: string, value: string) => {
				store.set(key, value);
				return Promise.resolve();
			}),
			del: jest.fn((key: string) => {
				store.delete(key);
				return Promise.resolve();
			}),
		};
		ordersService = {
			checkout: jest.fn().mockResolvedValue({
				orderId: 'order-1',
				status: 'PENDING_PAYMENT',
				payment_url: 'http://localhost:3000/orders/order-1/pay',
				expiresAt: '2030-01-01T00:00:00.000Z',
			}),
		};

		@Module({
			controllers: [CartController],
			providers: [
				{ provide: OrdersService, useValue: ordersService },
				{ provide: CachedService, useValue: cache },
				{
					provide: ConfigService,
					useValue: { get: jest.fn().mockReturnValue(API_KEY) },
				},
				RequestTrackerMiddleware,
				{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
			],
		})
		class TestModule implements NestModule {
			configure(consumer: MiddlewareConsumer) {
				consumer.apply(RequestTrackerMiddleware).forRoutes('*');
			}
		}

		const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
			.overrideGuard(JwtAuthGuard)
			.useClass(FakeJwtGuard)
			.compile();
		app = moduleRef.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			}),
		);
		await app.init();
	});

	afterEach(async () => {
		await app.close();
	});

	const post = (body: unknown, key?: string, user?: string) => {
		const req = request(app.getHttpServer())
			.post('/cart/checkout')
			.set('x-api-key', API_KEY);
		if (key) req.set('x-idempotency-key', key);
		if (user) req.set('x-test-user', user);
		return req.send(body as object);
	};

	it('gửi CHECKOUT với userId lấy từ token và dto đã validate', async () => {
		const res = await post(validBody, 'k1', 'user-42');
		expect(res.status).toBe(201);
		expect(ordersService.checkout).toHaveBeenCalledTimes(1);
		const [userId, dto] = ordersService.checkout.mock.calls[0];
		expect(userId).toBe('user-42');
		expect(dto.items).toEqual([{ productId: PRODUCT_A }]);
	});

	it.each([
		['userId', { ...validBody, userId: 'attacker' }],
		['quantity ở cấp body', { ...validBody, quantity: 99 }],
		[
			'quantity/unitPrice trong item',
			{
				...validBody,
				items: [{ productId: PRODUCT_A, quantity: 5, unitPrice: 1 }],
			},
		],
	])('body có %s -> 400, Orders không bị gọi', async (_name, body) => {
		const res = await post(body, 'k2');
		expect(res.status).toBe(400);
		expect(ordersService.checkout).not.toHaveBeenCalled();
	});

	it('items rỗng hoặc thiếu shippingAddress -> 400', async () => {
		expect((await post({ ...validBody, items: [] }, 'k3')).status).toBe(400);
		expect((await post({ items: validBody.items }, 'k4')).status).toBe(400);
		expect(ordersService.checkout).not.toHaveBeenCalled();
	});

	it('thiếu x-idempotency-key -> 400', async () => {
		const res = await post(validBody);
		expect(res.status).toBe(400);
		expect(ordersService.checkout).not.toHaveBeenCalled();
	});

	it('thiếu x-api-key -> 401', async () => {
		const res = await request(app.getHttpServer())
			.post('/cart/checkout')
			.set('x-idempotency-key', 'k5')
			.send(validBody);
		expect(res.status).toBe(401);
	});

	it('cùng key gửi lại -> response đã cache, status 201 gốc, Orders chỉ gọi 1 lần', async () => {
		const first = await post(validBody, 'same-key');
		const second = await post(validBody, 'same-key');
		expect(first.status).toBe(201);
		expect(second.status).toBe(201);
		expect(second.body).toEqual(first.body);
		expect(ordersService.checkout).toHaveBeenCalledTimes(1);
	});

	it('hai user cùng key không đụng nhau', async () => {
		await post(validBody, 'shared', 'user-a');
		const second = await post(validBody, 'shared', 'user-b');
		expect(second.status).toBe(201);
		expect(ordersService.checkout).toHaveBeenCalledTimes(2);
	});

	it('Redis lỗi -> 503 và không gọi Orders (fail-closed)', async () => {
		cache.get.mockRejectedValue(new Error('redis down'));
		const res = await post(validBody, 'k6');
		expect(res.status).toBe(503);
		expect(ordersService.checkout).not.toHaveBeenCalled();
	});

	it('Orders lỗi -> trả lỗi gốc và key được giải phóng để thử lại', async () => {
		ordersService.checkout.mockRejectedValueOnce(
			Object.assign(new Error('Hết hàng'), { status: 409 }),
		);
		const failed = await post(validBody, 'retry-key');
		expect(failed.status).toBeGreaterThanOrEqual(400);
		expect(store.size).toBe(0);
		const retried = await post(validBody, 'retry-key');
		expect(retried.status).toBe(201);
	});
});
