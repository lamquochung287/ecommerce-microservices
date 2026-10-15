import { Order } from '../entities/order.entity';

/** Làm tròn 2 chữ số thập phân (tiền VND/USD trong hệ thống dùng decimal(10,2)). */
export function round2(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Cột decimal của Postgres về dạng string; chuẩn hoá về number trước khi tính. */
export function toMoney(value: number | string | null | undefined): number {
	return round2(Number(value ?? 0));
}

/** Số tiền hoàn = tổng đã thu trừ phí ship (phí ship không hoàn ở mọi luồng). */
export function refundAmountOf(
	order: Pick<Order, 'totalAmount' | 'shippingFee'>,
): number {
	return round2(Number(order.totalAmount) - Number(order.shippingFee));
}
