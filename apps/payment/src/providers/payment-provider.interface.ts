export interface ChargeResult {
	success: boolean;
	transactionId?: string;
	failureReason?: string;
}

export interface WebhookVerifyResult {
	valid: boolean;
	eventId?: string;
	orderId?: string;
}

export interface PaymentProvider {
	charge(orderId: string, amount: number): Promise<ChargeResult>;
	verifyWebhook(
		payload: Record<string, unknown>,
		signature: string,
	): WebhookVerifyResult;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
