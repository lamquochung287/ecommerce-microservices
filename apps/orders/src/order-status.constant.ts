import { OrderStatus } from './entities/order.entity';

// Cạnh của luồng hiện hành: huỷ chỉ khi chưa giao cho hãng vận chuyển; hoàn hàng chỉ sau khi giao.
const CURRENT_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
	[OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
	[OrderStatus.PAID]: [OrderStatus.FULFILLING, OrderStatus.CANCELLED],
	[OrderStatus.FULFILLING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
	[OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
	[OrderStatus.DELIVERED]: [OrderStatus.REFUNDING, OrderStatus.COMPLETED],
	[OrderStatus.REFUNDING]: [OrderStatus.REFUNDED],
};

// Cạnh của Saga cũ (PENDING/PROCESSING) còn cần để luồng cũ biên dịch và chạy tới khi gỡ bỏ.
const LEGACY_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
	[OrderStatus.PENDING]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
	[OrderStatus.PROCESSING]: [OrderStatus.PAID, OrderStatus.CANCELLED],
	[OrderStatus.PAID]: [OrderStatus.SHIPPED],
	[OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
};

function mergeTransitions(
	...tables: Partial<Record<OrderStatus, OrderStatus[]>>[]
): Record<OrderStatus, OrderStatus[]> {
	const merged = {} as Record<OrderStatus, OrderStatus[]>;
	for (const status of Object.values(OrderStatus)) {
		merged[status] = [
			...new Set(tables.flatMap((table) => table[status] ?? [])),
		];
	}
	return merged;
}

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> =
	mergeTransitions(CURRENT_TRANSITIONS, LEGACY_TRANSITIONS);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
	return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
