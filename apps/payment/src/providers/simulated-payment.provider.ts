import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
	CreateIntentInput,
	PaymentProvider,
	PaymentSimulator,
	RefundInput,
	RefundResult,
	SimulatedPaymentResult,
	SimulatedWebhook,
	WebhookVerifyResult,
} from './payment-provider.interface';

const DEFAULT_PUBLIC_API_BASE_URL = 'http://localhost:3000';

// Provider mô phỏng — không gọi ra ngoài. Webhook vẫn ký HMAC thật bằng PAYMENT_WEBHOOK_SECRET (bắt buộc,
// không có fallback) và đi đúng đường verify như cổng thật. Chữ ký tính trên JSON.stringify(payload) nên
// phụ thuộc thứ tự key: payload do chính simulator dựng và chuyển nguyên object; provider thật phải ký raw body.
@Injectable()
export class SimulatedPaymentProvider
	implements PaymentProvider, PaymentSimulator
{
	constructor(private readonly configService: ConfigService) {}

	createIntent(input: CreateIntentInput): { checkoutUrl: string } {
		const base = this.configService
			.get<string>('PUBLIC_API_BASE_URL', DEFAULT_PUBLIC_API_BASE_URL)
			.replace(/\/+$/, '');
		return { checkoutUrl: `${base}/simulator/pay/${input.intentId}` };
	}

	refund(input: RefundInput): Promise<RefundResult> {
		void input;
		return Promise.resolve({ success: true });
	}

	signWebhook(payload: Record<string, unknown>): string {
		return createHmac('sha256', this.secret())
			.update(JSON.stringify(payload))
			.digest('hex');
	}

	verifyWebhook(
		payload: Record<string, unknown>,
		signature: string,
	): WebhookVerifyResult {
		if (typeof signature !== 'string') return { valid: false };
		const expected = Buffer.from(this.signWebhook(payload));
		const actual = Buffer.from(signature);
		// timingSafeEqual ném lỗi khi độ dài khác nhau nên kiểm tra trước.
		if (
			expected.length !== actual.length ||
			!timingSafeEqual(expected, actual)
		) {
			return { valid: false };
		}
		return {
			valid: true,
			eventId: payload.eventId as string,
			orderId: payload.orderId as string,
		};
	}

	// eventId tất định theo (intent, kết quả): bấm lặp hoặc replay là webhook trùng và bị idempotency chặn.
	buildWebhook(
		intent: { id: string; orderId: string; amount: number },
		result: SimulatedPaymentResult,
	): SimulatedWebhook {
		const status = result === 'success' ? 'SUCCEEDED' : 'FAILED';
		const payload: Record<string, unknown> = {
			eventId: `${intent.id}:${result}`,
			intentId: intent.id,
			orderId: intent.orderId,
			status,
			amount: Number(intent.amount),
			occurredAt: new Date().toISOString(),
		};
		return { payload, signature: this.signWebhook(payload) };
	}

	private secret(): string {
		return this.configService.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET');
	}
}
