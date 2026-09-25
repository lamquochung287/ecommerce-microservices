import { OrderStatus } from './entities/order.entity';

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	[OrderStatus.PENDING]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
	[OrderStatus.PROCESSING]: [OrderStatus.PAID, OrderStatus.CANCELLED],
	[OrderStatus.PAID]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
	[OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
	[OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
	[OrderStatus.CANCELLED]: [],
	[OrderStatus.REFUNDED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
	return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
