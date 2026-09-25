import { canTransition } from './order-status.constant';
import { OrderStatus } from './entities/order.entity';

describe('canTransition', () => {
	it('cho phép các transition hợp lệ trong state machine', () => {
		expect(canTransition(OrderStatus.PENDING, OrderStatus.PROCESSING)).toBe(true);
		expect(canTransition(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe(true);
		expect(canTransition(OrderStatus.PROCESSING, OrderStatus.PAID)).toBe(true);
		expect(canTransition(OrderStatus.PAID, OrderStatus.SHIPPED)).toBe(true);
		expect(canTransition(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
		expect(canTransition(OrderStatus.DELIVERED, OrderStatus.REFUNDED)).toBe(true);
	});

	it('từ chối transition không hợp lệ (nhảy state tuỳ ý)', () => {
		expect(canTransition(OrderStatus.SHIPPED, OrderStatus.PENDING)).toBe(false);
		expect(canTransition(OrderStatus.PENDING, OrderStatus.DELIVERED)).toBe(false);
		expect(canTransition(OrderStatus.PENDING, OrderStatus.SHIPPED)).toBe(false);
		expect(canTransition(OrderStatus.DELIVERED, OrderStatus.PENDING)).toBe(false);
	});

	it('CANCELLED và REFUNDED là terminal state, không chuyển tiếp được', () => {
		expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PENDING)).toBe(false);
		expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PROCESSING)).toBe(false);
		expect(canTransition(OrderStatus.REFUNDED, OrderStatus.DELIVERED)).toBe(false);
	});
});
