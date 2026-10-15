import { RpcException } from '@nestjs/microservices';
import { DataSource, EntityManager } from 'typeorm';
import { DiscountType, Voucher } from '../../entities/voucher.entity';
import { ApplyVoucherCommand } from '../apply-voucher.command';
import { ApplyVoucherHandler } from './apply-voucher.handler';

function setup(voucher: Voucher | null) {
	const manager = {
		findOne: jest.fn().mockResolvedValue(voucher),
		save: jest.fn().mockResolvedValue(undefined),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: EntityManager) => unknown) =>
			cb(manager as unknown as EntityManager),
		),
	};
	return {
		manager,
		handler: new ApplyVoucherHandler(dataSource as unknown as DataSource),
	};
}

const base = (): Voucher => ({
	id: 'v1',
	code: 'SALE',
	discountType: DiscountType.PERCENTAGE,
	discountValue: 10,
	minOrderValue: 0,
	expiresAt: new Date(Date.now() + 86_400_000),
	usageLimit: 2,
	usageCount: 0,
	createdAt: new Date(),
});

describe('ApplyVoucherHandler (hành vi giữ nguyên)', () => {
	it('khoá voucher, tăng usageCount và trả {code, discountAmount, finalAmount}', async () => {
		const voucher = base();
		const { manager, handler } = setup(voucher);

		const result = await handler.execute(
			new ApplyVoucherCommand({ code: 'SALE', orderValue: 200 }),
		);

		expect(result).toEqual({
			code: 'SALE',
			discountAmount: 20,
			finalAmount: 180,
		});
		expect(voucher.usageCount).toBe(1);
		expect(manager.findOne).toHaveBeenCalledWith(Voucher, {
			where: { code: 'SALE' },
			lock: { mode: 'pessimistic_write' },
		});
	});

	it('hết lượt: 400 và không tăng usageCount', async () => {
		const voucher = { ...base(), usageCount: 2 };
		const { manager, handler } = setup(voucher);

		await expect(
			handler.execute(new ApplyVoucherCommand({ code: 'SALE', orderValue: 1 })),
		).rejects.toBeInstanceOf(RpcException);
		expect(manager.save).not.toHaveBeenCalled();
	});
});
