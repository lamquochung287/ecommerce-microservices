import { refundAmountOf, round2, toMoney } from './money';

describe('money', () => {
	it('refundAmountOf = totalAmount - shippingFee', () => {
		expect(refundAmountOf({ totalAmount: 230000, shippingFee: 30000 })).toBe(
			200000,
		);
	});

	it('nhận decimal dạng string từ Postgres', () => {
		expect(
			refundAmountOf({
				totalAmount: '230000.00' as unknown as number,
				shippingFee: '30000.00' as unknown as number,
			}),
		).toBe(200000);
	});

	it('làm tròn 2 chữ số, không lệch float', () => {
		expect(round2(0.1 + 0.2)).toBe(0.3);
		expect(refundAmountOf({ totalAmount: 10.35, shippingFee: 0.1 })).toBe(
			10.25,
		);
	});

	it('toMoney xử lý null/undefined/string', () => {
		expect(toMoney(null)).toBe(0);
		expect(toMoney(undefined)).toBe(0);
		expect(toMoney('12.345')).toBe(12.35);
	});
});
