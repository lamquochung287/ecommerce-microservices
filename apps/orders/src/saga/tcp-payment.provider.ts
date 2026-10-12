import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { PAYMENT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CaptureResult, PaymentProvider } from './payment-provider.interface';
import { PAYMENT_TCP_CLIENT } from './payment-client.constant';

const TCP_TIMEOUT_MS = 10000;

// Gọi apps/payment (microservice riêng, Phase 2) qua TCP thay vì capture in-process.
// Payment service tự chọn provider thật/simulate qua PAYMENT_PROVIDER env — Orders không quan tâm.
@Injectable()
export class TcpPaymentProvider implements PaymentProvider {
	private readonly logger = new Logger(TcpPaymentProvider.name);

	constructor(
		@Inject(PAYMENT_TCP_CLIENT) private readonly paymentClient: ClientProxy,
	) {}

	async capture(
		orderId: string,
		amount: number,
		idempotencyKey: string,
	): Promise<CaptureResult> {
		try {
			return await firstValueFrom(
				this.paymentClient
					.send(
						{ cmd: PAYMENT_MESSAGE_PATTERN.CHARGE_PAYMENT },
						{ orderId, amount, idempotencyKey },
					)
					.pipe(timeout(TCP_TIMEOUT_MS)),
			);
		} catch (error) {
			this.logger.error(
				`Payment capture failed for orderId=${orderId}: ${error?.message ?? error}`,
			);
			return { success: false, failureReason: 'Payment service unavailable' };
		}
	}
}
