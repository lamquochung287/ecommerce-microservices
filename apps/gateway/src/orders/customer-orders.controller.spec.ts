/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
import {
	CanActivate,
	ExecutionContext,
	INestApplication,
	ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';

const ORDER_ID = 'c0a8012e-3f5b-4b5e-8b0b-0e7c9a1d2f10';

class FakeJwtGuard implements CanActivate {
	canActivate(context: ExecutionContext) {
		const req = context.switchToHttp().getRequest();
		req.user = { userId: 'user-from-token' };
		return true;
	}
}

describe('CustomerOrdersController', () => {
	let app: INestApplication;
	let ordersService: {
		getPaymentLink: jest.Mock;
		cancelOrder: jest.Mock;
		requestReturn: jest.Mock;
	};

	beforeEach(async () => {
		ordersService = {
			getPaymentLink: jest
				.fn()
				.mockResolvedValue({ paymentUrl: 'http://pay', expiresAt: 'x' }),
			cancelOrder: jest.fn().mockResolvedValue({ status: 'CANCELLED' }),
			requestReturn: jest.fn().mockResolvedValue({ status: 'REFUNDING' }),
		};
		const moduleRef = await Test.createTestingModule({
			controllers: [CustomerOrdersController],
			providers: [{ provide: OrdersService, useValue: ordersService }],
		})
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

	it('GET :id/pay truyền userId từ token', async () => {
		const res = await request(app.getHttpServer()).get(
			`/orders/${ORDER_ID}/pay`,
		);
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ paymentUrl: 'http://pay', expiresAt: 'x' });
		expect(ordersService.getPaymentLink).toHaveBeenCalledWith(
			ORDER_ID,
			'user-from-token',
		);
	});

	it('POST :id/cancel truyền userId từ token', async () => {
		const res = await request(app.getHttpServer()).post(
			`/orders/${ORDER_ID}/cancel`,
		);
		expect(res.status).toBe(201);
		expect(ordersService.cancelOrder).toHaveBeenCalledWith(
			ORDER_ID,
			'user-from-token',
		);
	});

	it('POST :id/return truyền userId từ token và reason', async () => {
		const res = await request(app.getHttpServer())
			.post(`/orders/${ORDER_ID}/return`)
			.send({ reason: 'Sai kích cỡ' });
		expect(res.status).toBe(201);
		expect(ordersService.requestReturn).toHaveBeenCalledWith(
			ORDER_ID,
			'user-from-token',
			'Sai kích cỡ',
		);
	});

	it('body return không được mang userId (không tin client)', async () => {
		const res = await request(app.getHttpServer())
			.post(`/orders/${ORDER_ID}/return`)
			.send({ reason: 'x', userId: 'attacker' });
		expect(res.status).toBe(400);
		expect(ordersService.requestReturn).not.toHaveBeenCalled();
	});

	it.each([
		['thiếu reason', {}],
		['reason rỗng', { reason: '' }],
		['reason quá 500 ký tự', { reason: 'a'.repeat(501) }],
	])('return %s -> 400', async (_name, body) => {
		const res = await request(app.getHttpServer())
			.post(`/orders/${ORDER_ID}/return`)
			.send(body);
		expect(res.status).toBe(400);
		expect(ordersService.requestReturn).not.toHaveBeenCalled();
	});

	it.each([
		['get', '/orders/not-a-uuid/pay'],
		['post', '/orders/not-a-uuid/cancel'],
		['post', '/orders/not-a-uuid/return'],
	])('id không phải UUID -> 400 (%s %s)', async (method, url) => {
		const server = request(app.getHttpServer());
		const res =
			method === 'get'
				? await server.get(url)
				: await server.post(url).send({ reason: 'x' });
		expect(res.status).toBe(400);
		expect(ordersService.getPaymentLink).not.toHaveBeenCalled();
		expect(ordersService.cancelOrder).not.toHaveBeenCalled();
		expect(ordersService.requestReturn).not.toHaveBeenCalled();
	});
});
