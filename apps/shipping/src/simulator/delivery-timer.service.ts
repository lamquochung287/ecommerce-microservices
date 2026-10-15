import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { SimulateDeliveryCommand } from '../commands/simulate-delivery.command';

/**
 * Hẹn giờ "giao hàng" cho simulator khi SHIPPING_SIM_DELIVER_DELAY_MS > 0.
 * Timer nằm trong bộ nhớ nên mất khi restart; endpoint SIMULATE_DELIVERY vẫn kích hoạt tay được.
 */
@Injectable()
export class DeliveryTimerService implements OnModuleDestroy {
	private readonly logger = new Logger(DeliveryTimerService.name);
	private readonly delayMs: number;
	private readonly timers = new Set<NodeJS.Timeout>();

	constructor(
		private readonly commandBus: CommandBus,
		config: ConfigService,
	) {
		this.delayMs = Number(
			config.get<number>('SHIPPING_SIM_DELIVER_DELAY_MS', 0),
		);
	}

	schedule(orderId: string): void {
		if (!(this.delayMs > 0)) return;
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			this.commandBus
				.execute(new SimulateDeliveryCommand(orderId))
				.catch((err: unknown) =>
					this.logger.error(
						`Tự giao hàng đơn ${orderId} lỗi: ${(err as Error).message}`,
					),
				);
		}, this.delayMs);
		// Không giữ tiến trình sống chỉ vì timer giao hàng mô phỏng.
		timer.unref();
		this.timers.add(timer);
	}

	onModuleDestroy(): void {
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
	}
}
