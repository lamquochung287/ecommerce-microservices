import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PAYMENT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import {
	PAYMENT_CLIENT,
	SERVICE_CALL_TIMEOUT_MS,
} from './client-tokens.constant';
import { sendTcp } from './rpc-error.util';

export interface CreatePaymentIntentRequest {
	orderId: string;
	amount: number;
	/** Luôn bằng orderId: Payment trả lại intent cũ khi gọi lặp. */
	idempotencyKey: string;
	/** ISO string, đúng bằng hạn giữ hàng. */
	expiresAt: string;
}

export interface PaymentIntentResult {
	intentId: string;
	status: string;
	checkoutUrl: string;
	expiresAt: string | null;
}

@Injectable()
export class PaymentClient {
	constructor(@Inject(PAYMENT_CLIENT) private readonly client: ClientProxy) {}

	createIntent(
		request: CreatePaymentIntentRequest,
	): Promise<PaymentIntentResult> {
		return sendTcp(
			this.client,
			PAYMENT_MESSAGE_PATTERN.CREATE_INTENT,
			request,
			SERVICE_CALL_TIMEOUT_MS,
		);
	}
}
