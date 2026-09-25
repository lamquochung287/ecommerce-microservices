export interface CaptureResult {
	success: boolean;
	transactionId?: string;
	failureReason?: string;
}

export interface PaymentProvider {
	capture(orderId: string, amount: number): Promise<CaptureResult>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
