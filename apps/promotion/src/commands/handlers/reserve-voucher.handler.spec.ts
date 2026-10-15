import { RpcException } from '@nestjs/microservices';
import { DataSource, EntityManager } from 'typeorm';
import { DiscountType, Voucher } from '../../entities/voucher.entity';
import {
	VoucherRedemption,
	VoucherRedemptionStatus,
} from '../../entities/voucher-redemption.entity';
import { ReserveVoucherCommand } from '../reserve-voucher.command';
import { ReserveVoucherHandler } from './reserve-voucher.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function setup(voucherOverrides: Partial<Voucher> = {}) {
	const voucher: Voucher = {
		id: 'v1',
		code: 'SALE',
		discountType: DiscountType.PERCENTAGE,
		discountValue: 10,
		minOrderValue: 0,
		expiresAt: new Date(Date.now() + 86_400_000),
		usageLimit: 1,
		usageCount: 0,
		createdAt: new Date(),
		...voucherOverrides,
	};
	const redemptions: Partial<VoucherRedemption>[] = [];
	const manager = {
		findOne: jest.fn(
			(entity: unknown, opts: { where: { orderId?: string } }) => {
				if (entity === Voucher) return Promise.resolve(voucher);
				return Promise.resolve(
					redemptions.find((r) => r.orderId === opts.where.orderId) ?? null,
				);
			},
		),
		save: jest.fn().mockResolvedValue(undefined),
		insert: jest.fn((_e: unknown, row: Partial<VoucherRedemption>) => {
			redemptions.push(row);
			return Promise.resolve();
		}),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: EntityManager) => unknown) =>
			cb(manager as unknown as EntityManager),
		),
	};
	const handler = new ReserveVoucherHandler(
		dataSource as unknown as DataSource,
	);
	const reserve = (orderId = ORDER_ID, orderValue = 100, code = 'SALE') =>
		handler.execute(
			new ReserveVoucherCommand({ code, orderId, userId: USER_ID, orderValue }),
		);
	return { voucher, redemptions, manager, reserve };
}

describe('ReserveVoucherHandler', () => {
	it('khoá voucher bằng pessimistic_write, tăng usageCount, ghi redemption RESERVED', async () => {
		const { voucher, redemptions, manager, reserve } = setup({ usageLimit: 3 });

		const result = await reserve();

		expect(result).toEqual({ code: 'SALE', discountAmount: 10 });
		expect(manager.findOne).toHaveBeenCalledWith(Voucher, {
			where: { code: 'SALE' },
			lock: { mode: 'pessimistic_write' },
		});
		expect(voucher.usageCount).toBe(1);
		expect(redemptions).toEqual([
			{
				voucherId: 'v1',
				code: 'SALE',
				orderId: ORDER_ID,
				userId: USER_ID,
				discountAmount: 10,
				status: VoucherRedemptionStatus.RESERVED,
			},
		]);
	});

	it('lặp cùng orderId: trả lại kết quả cũ, usageCount không tăng lần hai (kể cả khi đã hết lượt)', async () => {
		const { voucher, redemptions, reserve } = setup({ usageLimit: 1 });

		const first = await reserve();
		const second = await reserve();

		expect(second).toEqual(first);
		expect(voucher.usageCount).toBe(1);
		expect(redemptions).toHaveLength(1);
	});

	it('hết lượt với đơn khác: 400, không ghi redemption', async () => {
		const { redemptions, reserve } = setup({ usageLimit: 1 });
		await reserve();

		await expect(
			reserve('33333333-3333-4333-8333-333333333333'),
		).rejects.toMatchObject(
			new RpcException({
				statusCode: 400,
				message: 'Voucher usage limit reached',
			}),
		);
		expect(redemptions).toHaveLength(1);
	});

	it('voucher không tồn tại: 404', async () => {
		const { manager, reserve } = setup();
		manager.findOne.mockImplementationOnce(() => Promise.resolve(null));

		await expect(reserve()).rejects.toMatchObject(
			new RpcException({ statusCode: 404, message: 'Voucher not found' }),
		);
		expect(manager.insert).not.toHaveBeenCalled();
	});

	it('dưới minOrderValue: 400, usageCount giữ nguyên', async () => {
		const { voucher, reserve } = setup({ minOrderValue: 500 });

		await expect(reserve(ORDER_ID, 100)).rejects.toBeInstanceOf(RpcException);
		expect(voucher.usageCount).toBe(0);
	});

	it('đơn đã giữ voucher khác code: 409', async () => {
		const { redemptions, reserve } = setup({ usageLimit: 5 });
		redemptions.push({
			orderId: ORDER_ID,
			code: 'OTHER',
			status: VoucherRedemptionStatus.RESERVED,
			discountAmount: 5,
		});

		await expect(reserve()).rejects.toMatchObject(
			new RpcException({
				statusCode: 409,
				message: 'Order already holds a different voucher',
			}),
		);
	});

	it('redemption của đơn đã RELEASED: 409, không giữ lại lượt', async () => {
		const { voucher, redemptions, reserve } = setup({ usageLimit: 5 });
		redemptions.push({
			orderId: ORDER_ID,
			code: 'SALE',
			status: VoucherRedemptionStatus.RELEASED,
			discountAmount: 10,
		});

		await expect(reserve()).rejects.toMatchObject(
			new RpcException({
				statusCode: 409,
				message: 'Voucher reservation for this order was released',
			}),
		);
		expect(voucher.usageCount).toBe(0);
	});
});
