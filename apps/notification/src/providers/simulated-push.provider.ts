import { Injectable, Logger } from '@nestjs/common';
import { SendResult } from './email-provider.interface';
import { PushProvider } from './push-provider.interface';

// Provider mặc định (PUSH_PROVIDER=simulate) — không gọi FCM thật, chỉ log.
@Injectable()
export class SimulatedPushProvider implements PushProvider {
	private readonly logger = new Logger(SimulatedPushProvider.name);

	async send(to: string, title: string, body: string): Promise<SendResult> {
		this.logger.log(`[SIMULATED PUSH] to=${to} title="${title}" body="${body}"`);
		return { success: true };
	}
}
