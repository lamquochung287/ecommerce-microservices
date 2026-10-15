import { MESSAGE_TYPE } from 'libs/constant/kafka.constant';

export interface OrderEventEmail {
	subject: string;
	body: string;
}

/**
 * Nội dung email theo loại event của order-events. Trả null cho loại không gửi email
 * (OrderPaid/OrderCancelled dành cho consumer khác).
 */
export function buildOrderEventEmail(
	type: string,
	orderId: string,
	payload: Record<string, unknown>,
): OrderEventEmail | null {
	switch (type) {
		case MESSAGE_TYPE.ORDER_CREATED:
			return {
				subject: `Đơn hàng ${orderId} đã được tạo`,
				body: `Đơn hàng của bạn (tổng tiền ${String(payload.totalAmount)}) đã được xác nhận.`,
			};
		case MESSAGE_TYPE.ORDER_STATUS_CHANGED:
			return {
				subject: `Đơn hàng ${orderId} đã cập nhật trạng thái`,
				body: `Trạng thái đơn hàng chuyển từ ${String(payload.previousStatus)} sang ${String(payload.status)}.`,
			};
		default:
			return null;
	}
}
