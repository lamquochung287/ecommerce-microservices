// payment-commands
export interface RefundPaymentPayload {
	amount: number;
	reason: string;
}

// CancelPaymentIntent không có payload; orderId nằm ở envelope.
export type CancelPaymentIntentPayload = Record<string, never>;

// payment-events
export interface PaymentSucceededPayload {
	intentId: string;
	amount: number;
}

export interface PaymentFailedPayload {
	reason: string;
}

export interface PaymentRefundedPayload {
	refundId: string;
	amount: number;
}

export interface PaymentRefundFailedPayload {
	reason: string;
}
