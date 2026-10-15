export interface WebhookVerifyResult {
	valid: boolean;
	eventId?: string;
	orderId?: string;
}

export interface CreateIntentInput {
	intentId: string;
	orderId: string;
	amount: number;
	expiresAt: Date;
}

export interface RefundInput {
	orderId: string;
	transactionId: string;
	amount: number;
	reason: string;
}

export interface RefundResult {
	success: boolean;
	failureReason?: string;
}

export interface PaymentProvider {
	/** Trả URL để user thanh toán intent. */
	createIntent(input: CreateIntentInput): { checkoutUrl: string };
	refund(input: RefundInput): Promise<RefundResult>;
	/** Chữ ký HMAC-SHA256 (hex) của payload webhook. */
	signWebhook(payload: Record<string, unknown>): string;
	/** So khớp chữ ký theo thời gian hằng; chữ ký sai độ dài/định dạng luôn là không hợp lệ. */
	verifyWebhook(
		payload: Record<string, unknown>,
		signature: string,
	): WebhookVerifyResult;
}

export type SimulatedPaymentResult = 'success' | 'fail';

export interface SimulatedWebhook {
	payload: Record<string, unknown>;
	signature: string;
}

/** Khả năng riêng của provider mô phỏng: tự dựng webhook đã ký như cổng thật sẽ gửi. */
export interface PaymentSimulator {
	buildWebhook(
		intent: { id: string; orderId: string; amount: number },
		result: SimulatedPaymentResult,
	): SimulatedWebhook;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
