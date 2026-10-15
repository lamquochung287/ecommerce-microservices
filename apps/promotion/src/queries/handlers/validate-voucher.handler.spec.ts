import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { DiscountType, Voucher } from '../../entities/voucher.entity';
import { ValidateVoucherQuery } from '../validate-voucher.query';
import { ValidateVoucherHandler } from './validate-voucher.handler';

function build(found: Partial<Voucher> | null) {
	const findOne = jest.fn().mockResolvedValue(found);
	const save = jest.fn();
	const repo = { findOne, save } as unknown as Repository<Voucher>;
	return { handler: new ValidateVoucherHandler(repo), findOne, save };
}

const VALID: Partial<Voucher> = {
	code: 'SALE',
	discountType: DiscountType.PERCENTAGE,
	discountValue: 10,
	minOrderValue: 0,
	expiresAt: new Date(Date.now() + 86_400_000),
	usageLimit: 3,
	usageCount: 1,
};

describe('ValidateVoucherHandler', () => {
	it('trả {code, discountAmount} và không ghi gì', async () => {
		const { handler, save } = build(VALID);

		const result = await handler.execute(
			new ValidateVoucherQuery({ code: 'SALE', orderValue: 200 }),
		);

		expect(result).toEqual({ code: 'SALE', discountAmount: 20 });
		expect(save).not.toHaveBeenCalled();
	});

	it('không có voucher: 404', async () => {
		const { handler } = build(null);

		await expect(
			handler.execute(new ValidateVoucherQuery({ code: 'X', orderValue: 1 })),
		).rejects.toMatchObject(
			new RpcException({ statusCode: 404, message: 'Voucher not found' }),
		);
	});

	it('hết lượt: 400', async () => {
		const { handler } = build({ ...VALID, usageCount: 3 });

		await expect(
			handler.execute(
				new ValidateVoucherQuery({ code: 'SALE', orderValue: 100 }),
			),
		).rejects.toBeInstanceOf(RpcException);
	});
});
