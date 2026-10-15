import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CompleteDeliveredOrdersCommand } from '../commands/complete-delivered-orders.command';
import { ExpirePendingOrdersCommand } from '../commands/expire-pending-orders.command';

// Số đơn xử lý mỗi lượt quét; đổi bằng env ORDER_LIFECYCLE_BATCH_SIZE (mỗi đơn một transaction riêng).
export const ORDER_LIFECYCLE_BATCH_SIZE = 100;

/**
 * Quét định kỳ vòng đời đơn. Chạy được trên nhiều instance: mỗi đơn chỉ chuyển trạng thái một lần nhờ
 * khoá lạc quan (instance thua bỏ qua đơn đó). Cờ running chặn chạy chồng trong cùng instance.
 */
@Injectable()
export class OrderLifecycleScheduler {
	private readonly logger = new Logger(OrderLifecycleScheduler.name);
	private expiring = false;
	private completing = false;
	private readonly batchSize: number;

	constructor(
		private readonly commandBus: CommandBus,
		configService: ConfigService,
	) {
		this.batchSize = Number(
			configService.get('ORDER_LIFECYCLE_BATCH_SIZE') ??
				ORDER_LIFECYCLE_BATCH_SIZE,
		);
	}

	@Cron(CronExpression.EVERY_30_SECONDS)
	async expirePendingOrders(): Promise<void> {
		if (this.expiring) return;
		this.expiring = true;
		try {
			await this.commandBus.execute(
				new ExpirePendingOrdersCommand(this.batchSize),
			);
		} catch (err) {
			this.logger.error(`Quét đơn hết hạn lỗi: ${(err as Error).message}`);
		} finally {
			this.expiring = false;
		}
	}

	@Cron(CronExpression.EVERY_10_MINUTES)
	async completeDeliveredOrders(): Promise<void> {
		if (this.completing) return;
		this.completing = true;
		try {
			await this.commandBus.execute(
				new CompleteDeliveredOrdersCommand(this.batchSize),
			);
		} catch (err) {
			this.logger.error(`Quét đơn tự hoàn tất lỗi: ${(err as Error).message}`);
		} finally {
			this.completing = false;
		}
	}
}
