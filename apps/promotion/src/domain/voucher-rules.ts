import { RpcException } from '@nestjs/microservices';
import { DiscountType, Voucher } from '../entities/voucher.entity';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Số tiền giảm: PERCENTAGE làm tròn 2 số; FIXED không vượt quá giá trị đơn. */
export function calculateDiscount(
	voucher: Pick<Voucher, 'discountType' | 'discountValue'>,
	orderValue: number,
): number {
	const value = Number(voucher.discountValue);
	return voucher.discountType === DiscountType.PERCENTAGE
		? round2((orderValue * value) / 100)
		: Math.min(value, orderValue);
}

/**
 * Kiểm tra voucher theo thứ tự cố định: không có (404) -> hết hạn (400) -> hết lượt (400) -> dưới
 * minOrderValue (400), rồi trả số tiền giảm. Hàm thuần: caller tự quyết có khoá/ghi usageCount hay không.
 */
export function evaluateVoucher(
	voucher: Voucher | null,
	orderValue: number,
	now: number = Date.now(),
): number {
	if (!voucher) {
		throw new RpcException({ statusCode: 404, message: 'Voucher not found' });
	}
	if (voucher.expiresAt.getTime() < now) {
		throw new RpcException({
			statusCode: 400,
			message: 'Voucher has expired',
		});
	}
	if (voucher.usageCount >= voucher.usageLimit) {
		throw new RpcException({
			statusCode: 400,
			message: 'Voucher usage limit reached',
		});
	}
	if (orderValue < Number(voucher.minOrderValue)) {
		throw new RpcException({
			statusCode: 400,
			message: `Order value must be at least ${voucher.minOrderValue} to use this voucher`,
		});
	}
	return calculateDiscount(voucher, orderValue);
}
