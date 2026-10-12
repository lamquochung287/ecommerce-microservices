import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendResult } from './email-provider.interface';

// Provider mặc định (EMAIL_PROVIDER=simulate) — không gọi Resend/Brevo thật, chỉ log.
// Kết quả gửi được ghi vào bảng sent_notifications ở handler gọi provider này, không phải ở đây.
@Injectable()
export class SimulatedEmailProvider implements EmailProvider {
	private readonly logger = new Logger(SimulatedEmailProvider.name);

	async send(to: string, subject: string, body: string): Promise<SendResult> {
		this.logger.log(
			`[SIMULATED EMAIL] to=${to} subject="${subject}" body="${body}"`,
		);
		return { success: true };
	}
}
