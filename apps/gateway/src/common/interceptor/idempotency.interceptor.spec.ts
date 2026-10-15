/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
import {
	BadRequestException,
	CallHandler,
	ExecutionContext,
	ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';

// @lib/cached kéo @nestjs/terminus (ESM-only) mà jest CJS không nạp được; chỉ cần token kiểu.
jest.mock('@lib/cached', () => ({ CachedService: class CachedService {} }));

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RequireIdempotencyKey } from '../decorator/require-idempotency-key.decorator';

class RequiredController {
	@RequireIdempotencyKey()
	required() {}
	optional() {}
}

type FakeCache = {
	get: jest.Mock;
	set: jest.Mock;
	del: jest.Mock;
};

const buildContext = (
	handlerName: 'required' | 'optional',
	req: Record<string, unknown>,
	res: { statusCode: number; status: jest.Mock },
) =>
	({
		switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
		getHandler: () => RequiredController.prototype[handlerName],
		getClass: () => RequiredController,
	}) as unknown as ExecutionContext;

describe('IdempotencyInterceptor', () => {
	let cache: FakeCache;
	let store: Map<string, string>;
	let interceptor: IdempotencyInterceptor;
	let res: { statusCode: number; status: jest.Mock };

	const request = (overrides: Record<string, unknown> = {}) => ({
		method: 'POST',
		path: '/cart/checkout',
		idempotencyKey: 'key-1',
		user: { userId: 'u1' },
		...overrides,
	});

	const handler = (value: unknown = { orderId: 'o1' }): CallHandler => ({
		handle: jest.fn().mockReturnValue(of(value)),
	});

	beforeEach(() => {
		store = new Map();
		cache = {
			get: jest.fn(async (key: string) => store.get(key) ?? null),
			set: jest.fn(async (key: string, value: string) => {
				store.set(key, value);
			}),
			del: jest.fn(async (key: string) => {
				store.delete(key);
			}),
		};
		interceptor = new IdempotencyInterceptor(cache as never, new Reflector());
		res = { statusCode: 201, status: jest.fn() };
	});

	const run = async (
		name: 'required' | 'optional',
		req: Record<string, unknown>,
		next: CallHandler,
	) =>
		lastValueFrom(
			await interceptor.intercept(buildContext(name, req, res), next),
		);

	it('route bắt buộc thiếu header -> 400, không chạy handler', async () => {
		const next = handler();
		await expect(
			run('required', request({ idempotencyKey: undefined }), next),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(next.handle).not.toHaveBeenCalled();
	});

	it('route thường thiếu header -> chạy tiếp, không đụng Redis', async () => {
		const next = handler();
		await run('optional', request({ idempotencyKey: undefined }), next);
		expect(next.handle).toHaveBeenCalledTimes(1);
		expect(cache.get).not.toHaveBeenCalled();
	});

	it('key chứa ký tự lạ hoặc quá dài -> 400', async () => {
		await expect(
			run('required', request({ idempotencyKey: 'a b' }), handler()),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			run('required', request({ idempotencyKey: 'x'.repeat(129) }), handler()),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('method an toàn (GET) bỏ qua hoàn toàn', async () => {
		const next = handler();
		await run(
			'required',
			request({ method: 'GET', idempotencyKey: undefined }),
			next,
		);
		expect(next.handle).toHaveBeenCalledTimes(1);
		expect(cache.get).not.toHaveBeenCalled();
	});

	it('route bắt buộc + Redis lỗi -> 503, không chạy handler (fail-closed)', async () => {
		cache.get.mockRejectedValue(new Error('redis down'));
		const next = handler();
		await expect(run('required', request(), next)).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
		expect(next.handle).not.toHaveBeenCalled();
	});

	it('route bắt buộc + Redis lỗi ở bước ghi marker -> 503', async () => {
		cache.set.mockRejectedValue(new Error('redis down'));
		await expect(run('required', request(), handler())).rejects.toBeInstanceOf(
			ServiceUnavailableException,
		);
	});

	it('route thường + Redis lỗi -> vẫn chạy handler (fail-open)', async () => {
		cache.get.mockRejectedValue(new Error('redis down'));
		const next = handler({ ok: 1 });
		await expect(run('optional', request(), next)).resolves.toEqual({ ok: 1 });
		expect(next.handle).toHaveBeenCalledTimes(1);
	});

	it('hai user cùng key không đụng nhau (key scope theo user)', async () => {
		const next = handler();
		await run('required', request({ user: { userId: 'u1' } }), next);
		await run('required', request({ user: { userId: 'u2' } }), next);
		expect(next.handle).toHaveBeenCalledTimes(2);
		const keys = [...store.keys()];
		expect(keys).toHaveLength(2);
		expect(keys[0]).toContain('u1');
		expect(keys[1]).toContain('u2');
	});

	it('cùng user + cùng key nhưng khác route -> không đụng nhau', async () => {
		const next = handler();
		await run('required', request({ path: '/cart/checkout' }), next);
		await run('required', request({ path: '/orders/x/return' }), next);
		expect(next.handle).toHaveBeenCalledTimes(2);
	});

	it('không có user (anon) vẫn có scope riêng', async () => {
		await run('required', request({ user: undefined }), handler());
		expect([...store.keys()][0]).toContain('idempotency:anon:POST:');
	});

	it('replay trả lại response đã cache và đúng status gốc, handler chạy 1 lần', async () => {
		const next = handler({ orderId: 'o1' });
		await expect(run('required', request(), next)).resolves.toEqual({
			orderId: 'o1',
		});
		res.status.mockClear();
		await expect(run('required', request(), next)).resolves.toEqual({
			orderId: 'o1',
		});
		expect(next.handle).toHaveBeenCalledTimes(1);
		expect(res.status).toHaveBeenCalledWith(201);
	});

	it('đang processing -> 409', async () => {
		store.set(
			'idempotency:u1:POST:/cart/checkout:key-1',
			JSON.stringify({ status: 'processing' }),
		);
		const next = handler();
		await expect(run('required', request(), next)).rejects.toMatchObject({
			status: 409,
		});
		expect(next.handle).not.toHaveBeenCalled();
	});

	it('handler lỗi -> xoá key để client thử lại', async () => {
		const next: CallHandler = {
			handle: jest.fn().mockReturnValue(throwError(() => new Error('boom'))),
		};
		await expect(run('required', request(), next)).rejects.toThrow('boom');
		expect(store.size).toBe(0);
		expect(cache.del).toHaveBeenCalledTimes(1);
	});

	it('marker processing có TTL ngắn hơn kết quả đã xử lý xong', async () => {
		await run('required', request(), handler());
		const ttls = cache.set.mock.calls.map((call) => call[2] as number);
		expect(ttls[0]).toBeLessThan(ttls[1]);
	});
});
