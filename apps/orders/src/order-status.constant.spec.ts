import {
	canTransition,
	ORDER_STATUS_TRANSITIONS,
} from './order-status.constant';
import { OrderStatus } from './entities/order.entity';

const S = OrderStatus;

describe('canTransition', () => {
	it.each([
		[S.PENDING_PAYMENT, S.PAID],
		[S.PENDING_PAYMENT, S.CANCELLED],
		[S.PAID, S.FULFILLING],
		[S.PAID, S.CANCELLED],
		[S.FULFILLING, S.SHIPPED],
		[S.FULFILLING, S.CANCELLED],
		[S.SHIPPED, S.DELIVERED],
		[S.DELIVERED, S.REFUNDING],
		[S.DELIVERED, S.COMPLETED],
		[S.REFUNDING, S.REFUNDED],
	])('cho phép %s -> %s', (from, to) => {
		expect(canTransition(from, to)).toBe(true);
	});

	it.each([
		[S.SHIPPED, S.CANCELLED],
		[S.DELIVERED, S.CANCELLED],
		[S.COMPLETED, S.REFUNDING],
		[S.PENDING_PAYMENT, S.FULFILLING],
		[S.PAID, S.DELIVERED],
		[S.REFUNDING, S.COMPLETED],
		[S.SHIPPED, S.PENDING_PAYMENT],
	])('từ chối %s -> %s', (from, to) => {
		expect(canTransition(from, to)).toBe(false);
	});

	it.each([S.CANCELLED, S.REFUNDED, S.COMPLETED])(
		'%s là terminal, không có cạnh đi ra',
		(status) => {
			expect(ORDER_STATUS_TRANSITIONS[status]).toEqual([]);
		},
	);

	it('enum chốt: không còn trạng thái PENDING/PROCESSING của luồng đồng bộ cũ', () => {
		expect(Object.values(S).sort()).toEqual(
			[
				'PENDING_PAYMENT',
				'PAID',
				'FULFILLING',
				'SHIPPED',
				'DELIVERED',
				'COMPLETED',
				'CANCELLED',
				'REFUNDING',
				'REFUNDED',
			].sort(),
		);
	});

	it('mọi trạng thái đều có mục trong bảng', () => {
		for (const status of Object.values(S)) {
			expect(Array.isArray(ORDER_STATUS_TRANSITIONS[status])).toBe(true);
		}
	});
});
