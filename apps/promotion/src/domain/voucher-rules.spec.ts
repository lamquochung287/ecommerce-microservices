import { RpcException } from '@nestjs/microservices';
import { DiscountType, Voucher } from '../entities/voucher.entity';
import { calculateDiscount, evaluateVoucher } from './voucher-rules';

const NOW = new Date('2026-01-01T00:00:00Z').getTime();

function voucher(overrides: Partial<Voucher> = {}): Voucher {
	return {
		id: 'v1',
		code: 'SALE',
		discountType: DiscountType.PERCENTAGE,
		discountValue: 10,
		minOrderValue: 0,
		expiresAt: new Date(NOW + 86_400_000),
		usageLimit: 5,
		usageCount: 0,
		createdAt: new Date(NOW),
		...overrides,
	};
}

function errorOf(fn: () => unknown): { statusCode: number; message: string } {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(RpcException);
		return (err as RpcException).getError() as {
			statusCode: number;
			message: string;
		};
	}
	throw new Error('expected to throw');
}

describe('voucher-rules', () => {
	describe('calculateDiscount', () => {
		it('PERCENTAGE làm tròn 2 số', () => {
			expect(calculateDiscount(voucher({ discountValue: 15 }), 33.33)).toBe(5);
			expect(calculateDiscount(voucher({ discountValue: 12.5 }), 99.99)).toBe(
				12.5,
			);
		});

		it('discountValue dạng chuỗi decimal từ Postgres vẫn tính đúng', () => {
			expect(
				calculateDiscount(
					voucher({ discountValue: '10.00' as unknown as number }),
					200,
				),
			).toBe(20);
		});

		it('FIXED lấy min(giá trị, orderValue)', () => {
			const fixed = voucher({
				discountType: DiscountType.FIXED,
				discountValue: 50,
			});
			expect(calculateDiscount(fixed, 200)).toBe(50);
			expect(calculateDiscount(fixed, 30)).toBe(30);
		});
	});

	describe('evaluateVoucher', () => {
		it('hợp lệ: trả discount', () => {
			expect(evaluateVoucher(voucher(), 100, NOW)).toBe(10);
		});

		it('không có voucher: 404', () => {
			expect(errorOf(() => evaluateVoucher(null, 100, NOW))).toEqual({
				statusCode: 404,
				message: 'Voucher not found',
			});
		});

		it('hết hạn: 400', () => {
			const v = voucher({ expiresAt: new Date(NOW - 1) });
			expect(errorOf(() => evaluateVoucher(v, 100, NOW))).toMatchObject({
				statusCode: 400,
				message: 'Voucher has expired',
			});
		});

		it('hết lượt: 400', () => {
			const v = voucher({ usageLimit: 2, usageCount: 2 });
			expect(errorOf(() => evaluateVoucher(v, 100, NOW))).toMatchObject({
				statusCode: 400,
				message: 'Voucher usage limit reached',
			});
		});

		it('dưới minOrderValue: 400; bằng minOrderValue vẫn hợp lệ', () => {
			const v = voucher({ minOrderValue: '100.00' as unknown as number });
			expect(errorOf(() => evaluateVoucher(v, 99.99, NOW))).toMatchObject({
				statusCode: 400,
			});
			expect(evaluateVoucher(v, 100, NOW)).toBe(10);
		});

		it('thứ tự kiểm tra: hết hạn ưu tiên hơn hết lượt', () => {
			const v = voucher({
				expiresAt: new Date(NOW - 1),
				usageLimit: 1,
				usageCount: 1,
			});
			expect(errorOf(() => evaluateVoucher(v, 100, NOW)).message).toBe(
				'Voucher has expired',
			);
		});
	});
});
