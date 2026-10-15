import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
	CreatedShipment,
	CreateShipmentInput,
	ShippingProvider,
} from './shipping-provider.interface';

export const SIMULATED_CARRIER = 'SIMULATED';

// Provider mô phỏng — không gọi ra ngoài. Webhook vẫn ký HMAC thật bằng SHIPPING_WEBHOOK_SECRET (bắt buộc,
// không có fallback) và đi đúng đường verify như carrier thật. Chữ ký tính trên JSON.stringify(payload) nên
// phụ thuộc thứ tự key: payload do chính simulator dựng; carrier thật phải ký raw body.
@Injectable()
export class SimulatedShippingProvider implements ShippingProvider {
	constructor(private readonly config: ConfigService) {}

	createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
		void input;
		// SHIPPING_SIM_MODE đọc mỗi lần gọi để đổi chế độ khi kiểm thử không cần dựng lại provider.
		if (this.config.get<string>('SHIPPING_SIM_MODE', 'success') === 'fail') {
			return Promise.reject(new Error('Simulated carrier failure'));
		}
		return Promise.resolve({
			trackingCode: `SIM-${randomBytes(6).toString('hex').toUpperCase()}`,
			carrier: SIMULATED_CARRIER,
		});
	}

	cancelShipment(trackingCode: string): Promise<void> {
		void trackingCode;
		return Promise.resolve();
	}

	signWebhook(payload: Record<string, unknown>): string {
		return createHmac('sha256', this.secret())
			.update(JSON.stringify(payload))
			.digest('hex');
	}

	verifyWebhook(payload: Record<string, unknown>, signature: string): boolean {
		if (typeof signature !== 'string') return false;
		const expected = Buffer.from(this.signWebhook(payload));
		const actual = Buffer.from(signature);
		// timingSafeEqual ném lỗi khi độ dài khác nhau nên kiểm tra trước.
		return (
			expected.length === actual.length && timingSafeEqual(expected, actual)
		);
	}

	private secret(): string {
		return this.config.getOrThrow<string>('SHIPPING_WEBHOOK_SECRET');
	}
}
