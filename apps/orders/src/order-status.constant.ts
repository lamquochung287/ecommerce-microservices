import { OrderStatus } from './entities/order.entity';

// Huỷ chỉ khi chưa giao cho hãng vận chuyển; hoàn hàng chỉ sau khi giao.
// Terminal: CANCELLED, REFUNDED, COMPLETED (không có cạnh đi ra).
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	[OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
	[OrderStatus.PAID]: [OrderStatus.FULFILLING, OrderStatus.CANCELLED],
	[OrderStatus.FULFILLING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
	[OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
	[OrderStatus.DELIVERED]: [OrderStatus.REFUNDING, OrderStatus.COMPLETED],
	[OrderStatus.REFUNDING]: [OrderStatus.REFUNDED],
	[OrderStatus.CANCELLED]: [],
	[OrderStatus.REFUNDED]: [],
	[OrderStatus.COMPLETED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
	return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
