export interface CaptureResult {
	success: boolean;
	transactionId?: string;
	failureReason?: string;
}

export interface PaymentProvider {
	capture(
		orderId: string,
		amount: number,
		idempotencyKey: string,
	): Promise<CaptureResult>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
