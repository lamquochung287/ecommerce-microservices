export interface OrderCreatedPayload {
	userId: string;
	totalAmount: number;
	expiresAt: string;
}

export interface OrderStatusChangedPayload {
	userId: string;
	previousStatus: string;
	status: string;
	cancelReason?: string;
}

export interface OrderPaidPayload {
	userId: string;
	voucherCode?: string;
}

export interface OrderCancelledPayload {
	userId: string;
	/** true = đơn đã thanh toán (voucher không trả); false = chưa thanh toán (trả lượt voucher). */
	paid: boolean;
	cancelReason: string;
	voucherCode?: string;
}
