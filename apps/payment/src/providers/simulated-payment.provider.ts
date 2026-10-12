import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
	ChargeResult,
	PaymentProvider,
	WebhookVerifyResult,
} from './payment-provider.interface';

// Provider mặc định (PAYMENT_PROVIDER=simulate) — không gọi ra ngoài, luôn trả success.
// Test compensation/failure path bằng cách inject 1 provider giả throw lỗi, không sửa provider này
// (đã áp dụng đúng nguyên tắc chỗ apps/orders/src/saga/simulated-payment.provider.ts cũ).
@Injectable()
export class SimulatedPaymentProvider implements PaymentProvider {
	constructor(private readonly configService: ConfigService) {}

	async charge(orderId: string, amount: number): Promise<ChargeResult> {
		return {
			success: true,
			transactionId: `SIMULATED-${orderId}`,
		};
	}

	// Webhook giả lập vẫn ký HMAC thật (cùng cơ chế provider thật sẽ dùng), chỉ khác ở chỗ payload
	// do chính hệ thống tự phát sinh thay vì nhận từ VNPay/MoMo.
	verifyWebhook(
		payload: Record<string, unknown>,
		signature: string,
	): WebhookVerifyResult {
		const secret = this.configService.get<string>(
			'PAYMENT_WEBHOOK_SECRET',
			'simulated-webhook-secret',
		);
		const expectedSignature = createHmac('sha256', secret)
			.update(JSON.stringify(payload))
			.digest('hex');

		if (expectedSignature !== signature) {
			return { valid: false };
		}

		return {
			valid: true,
			eventId: payload.eventId as string,
			orderId: payload.orderId as string,
		};
	}
}
