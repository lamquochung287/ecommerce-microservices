import { Injectable } from '@nestjs/common';
import { CaptureResult, PaymentProvider } from './payment-provider.interface';

// Payment service thật chưa tồn tại (Phase 2). Theo chiến lược "Simulate trước, Real sau" của roadmap,
// provider này luôn trả success ở runtime bình thường — không random fail để tránh huỷ đơn vô cớ khi demo.
// Integration test verify đường compensation bằng cách tự inject 1 provider giả throw lỗi, không sửa provider này.
@Injectable()
export class SimulatedPaymentProvider implements PaymentProvider {
	async capture(orderId: string, amount: number): Promise<CaptureResult> {
		return {
			success: true,
			transactionId: `SIMULATED-${orderId}`,
		};
	}
}
