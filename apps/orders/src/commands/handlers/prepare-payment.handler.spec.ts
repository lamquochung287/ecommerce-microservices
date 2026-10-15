// Mock manager/outbox trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { InventoryClient } from '../../clients/inventory.client';
import { PaymentClient } from '../../clients/payment.client';
import { OrderStatus } from '../../entities/order.entity';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { OrderVersionConflictError } from '../../order-state/order-version-conflict.error';
import { PreparePaymentCommand } from '../prepare-payment.command';
import { PreparePaymentHandler } from './prepare-payment.handler';

const USER = 'u-1';
const FUTURE = new Date(Date.now() + 10 * 60 * 1000);

function makeOrder(extra: Record<string, unknown> = {}) {
	return {
		id: 'o-1',
		userId: USER,
		status: OrderStatus.PENDING_PAYMENT,
		version: 2,
		totalAmount: '305000.00',
		expiresAt: FUTURE,
		paymentIntentId: 'intent-1',
		paymentCheckoutUrl: 'http://pay/simulator/pay/intent-1',
		...extra,
	};
}

function setup(order: unknown) {
	const manager = { findOne: jest.fn().mockResolvedValue(order) };
	const dataSource = {
		manager,
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const inventory = {
		checkReservation: jest
			.fn()
			.mockResolvedValue({ valid: true, status: 'RESERVED', expiresAt: null }),
	};
	const payment = {
		createIntent: jest.fn().mockResolvedValue({
			intentId: 'intent-2',
			status: 'PENDING',
			checkoutUrl: 'http://pay/simulator/pay/intent-2',
			expiresAt: null,
		}),
	};
	const transition = jest.fn().mockResolvedValue({});
	const updateWithVersion = jest.fn().mockResolvedValue({});
	const orderTransition = {
		transition,
		updateWithVersion,
	} as unknown as OrderTransitionService;
	const handler = new PreparePaymentHandler(
		dataSource as unknown as DataSource,
		inventory as unknown as InventoryClient,
		payment as unknown as PaymentClient,
		orderTransition,
		new OrderCancellationService(orderTransition),
	);
	return {
		handler,
		manager,
		inventory,
		payment,
		transition,
		updateWithVersion,
	};
}

const run = (handler: PreparePaymentHandler, userId = USER) =>
	handler.execute(new PreparePaymentCommand('o-1', userId));

const errorOf = (error: unknown) =>
	(error as RpcException).getError() as { statusCode: number; message: string };

describe('PreparePaymentHandler', () => {
	it('đơn của user khác hoặc không tồn tại -> 404', async () => {
		const other = setup(makeOrder());
		expect(
			errorOf(await run(other.handler, 'someone-else').catch((e) => e))
				.statusCode,
		).toBe(404);

		const missing = setup(null);
		expect(errorOf(await run(missing.handler).catch((e) => e)).statusCode).toBe(
			404,
		);
		expect(other.inventory.checkReservation).not.toHaveBeenCalled();
	});

	it('không còn PENDING_PAYMENT -> 409, không huỷ gì', async () => {
		const ctx = setup(makeOrder({ status: OrderStatus.CANCELLED }));
		const error = errorOf(await run(ctx.handler).catch((e) => e));
		expect(error).toMatchObject({
			statusCode: 409,
			message: 'Đơn không còn chờ thanh toán',
		});
		expect(ctx.transition).not.toHaveBeenCalled();
	});

	it('quá expiresAt -> huỷ PAYMENT_EXPIRED + ReleaseInventory + CancelPaymentIntent, 409', async () => {
		const ctx = setup(makeOrder({ expiresAt: new Date(Date.now() - 1000) }));
		const error = errorOf(await run(ctx.handler).catch((e) => e));

		expect(error).toMatchObject({
			statusCode: 409,
			message: 'Hết hàng hoặc hết hạn giữ hàng',
		});
		const [, input] = ctx.transition.mock.calls[0];
		expect(input.to).toBe(OrderStatus.CANCELLED);
		expect(input.patch).toEqual({ cancelReason: 'PAYMENT_EXPIRED' });
		expect(input.messages.map((m: any) => m.type)).toEqual([
			'ReleaseInventory',
			'CancelPaymentIntent',
			'OrderCancelled',
		]);
		expect(ctx.inventory.checkReservation).not.toHaveBeenCalled();
	});

	it('reservation mất -> huỷ RESERVATION_INVALID, 409 cùng thông báo', async () => {
		const ctx = setup(makeOrder());
		ctx.inventory.checkReservation.mockResolvedValue({
			valid: false,
			status: 'EXPIRED',
			expiresAt: null,
		});
		const error = errorOf(await run(ctx.handler).catch((e) => e));

		expect(error).toMatchObject({
			statusCode: 409,
			message: 'Hết hàng hoặc hết hạn giữ hàng',
		});
		expect(ctx.transition.mock.calls[0][1].patch).toEqual({
			cancelReason: 'RESERVATION_INVALID',
		});
	});

	it('lệch version khi huỷ -> 409 "đơn vừa thay đổi"', async () => {
		const ctx = setup(makeOrder({ expiresAt: new Date(Date.now() - 1000) }));
		ctx.transition.mockRejectedValue(new OrderVersionConflictError('o-1'));
		const error = errorOf(await run(ctx.handler).catch((e) => e));
		expect(error.statusCode).toBe(409);
		expect(error.message).toContain('Đơn vừa thay đổi');
	});

	it('chưa có intent -> tạo intent idempotent (key=orderId, hạn=expiresAt) rồi lưu và trả paymentUrl', async () => {
		const ctx = setup(
			makeOrder({ paymentIntentId: null, paymentCheckoutUrl: null }),
		);

		const result = await run(ctx.handler);

		expect(ctx.payment.createIntent).toHaveBeenCalledWith({
			orderId: 'o-1',
			amount: 305000,
			idempotencyKey: 'o-1',
			expiresAt: FUTURE.toISOString(),
		});
		expect(ctx.updateWithVersion.mock.calls[0][2]).toEqual({
			paymentIntentId: 'intent-2',
			paymentCheckoutUrl: 'http://pay/simulator/pay/intent-2',
		});
		expect(result).toEqual({
			paymentUrl: 'http://pay/simulator/pay/intent-2',
			expiresAt: FUTURE.toISOString(),
		});
	});

	it('đã có intent -> trả link đã lưu, không gọi Payment', async () => {
		const ctx = setup(makeOrder());
		const result = await run(ctx.handler);
		expect(result).toEqual({
			paymentUrl: 'http://pay/simulator/pay/intent-1',
			expiresAt: FUTURE.toISOString(),
		});
		expect(ctx.payment.createIntent).not.toHaveBeenCalled();
		expect(ctx.transition).not.toHaveBeenCalled();
	});
});
