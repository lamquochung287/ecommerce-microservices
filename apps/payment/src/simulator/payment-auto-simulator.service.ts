import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { HandlePaymentWebhookCommand } from '../commands/handle-payment-webhook.command';
import {
	PAYMENT_PROVIDER,
	PaymentProvider,
	PaymentSimulator,
} from '../providers/payment-provider.interface';

const DEFAULT_DELAY_MS = 3000;

// Chế độ auto của simulator: sau một độ trễ tự gửi webhook đã ký qua đúng handler webhook thật.
// Timer nằm trong bộ nhớ nên mất khi restart — chỉ phục vụ môi trường dev; manual là mặc định và
// production luôn tắt.
@Injectable()
export class PaymentAutoSimulatorService implements OnModuleDestroy {
	private readonly logger = new Logger(PaymentAutoSimulatorService.name);
	private readonly timers = new Set<NodeJS.Timeout>();

	constructor(
		private readonly configService: ConfigService,
		private readonly commandBus: CommandBus,
		@Inject(PAYMENT_PROVIDER)
		private readonly paymentProvider: PaymentProvider & PaymentSimulator,
	) {}

	schedule(intent: { id: string; orderId: string; amount: number }): void {
		if (this.configService.get<string>('NODE_ENV') === 'production') return;
		const mode = this.configService.get<string>('PAYMENT_SIM_MODE', 'manual');
		if (mode !== 'auto-success' && mode !== 'auto-fail') return;

		const delay = this.configService.get<number>(
			'PAYMENT_SIM_DELAY_MS',
			DEFAULT_DELAY_MS,
		);
		const result = mode === 'auto-success' ? 'success' : 'fail';
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			void this.fire(intent, result);
		}, delay);
		timer.unref();
		this.timers.add(timer);
	}

	onModuleDestroy(): void {
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
	}

	private async fire(
		intent: { id: string; orderId: string; amount: number },
		result: 'success' | 'fail',
	): Promise<void> {
		try {
			const webhook = this.paymentProvider.buildWebhook(
				{
					id: intent.id,
					orderId: intent.orderId,
					amount: Number(intent.amount),
				},
				result,
			);
			await this.commandBus.execute(new HandlePaymentWebhookCommand(webhook));
		} catch (err) {
			this.logger.error(
				`Auto simulation failed for intent ${intent.id}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
