import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { OrderVersionConflictError } from '../../order-state/order-version-conflict.error';
import { returnWindowMs } from '../../order-state/return-window';
import { CompleteDeliveredOrdersCommand } from '../complete-delivered-orders.command';

export interface CompleteDeliveredOrdersResult {
	completed: number;
	skipped: number;
	failed: number;
}

/**
 * DELIVERED quá cửa sổ đổi trả -> COMPLETED. Chỉ chọn đơn DELIVERED nên đơn REFUNDING không bị đụng.
 * Mỗi đơn một transaction, đọc lại đơn; lệch version (user vừa bấm hoàn hàng) thì bỏ qua.
 */
@CommandHandler(CompleteDeliveredOrdersCommand)
export class CompleteDeliveredOrdersHandler implements ICommandHandler<CompleteDeliveredOrdersCommand> {
	private readonly logger = new Logger(CompleteDeliveredOrdersHandler.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly orderTransition: OrderTransitionService,
		private readonly config: ConfigService,
	) {}

	async execute(
		command: CompleteDeliveredOrdersCommand,
	): Promise<CompleteDeliveredOrdersResult> {
		const result: CompleteDeliveredOrdersResult = {
			completed: 0,
			skipped: 0,
			failed: 0,
		};
		const cutoff = new Date(Date.now() - returnWindowMs(this.config));
		const candidates = await this.dataSource.manager.find(Order, {
			where: {
				status: OrderStatus.DELIVERED,
				deliveredAt: LessThanOrEqual(cutoff),
			},
			order: { deliveredAt: 'ASC' },
			take: command.batchSize,
			loadEagerRelations: false,
		});

		for (const candidate of candidates) {
			try {
				const done = await this.dataSource.transaction(async (manager) => {
					const order = await manager.findOne(Order, {
						where: { id: candidate.id },
						loadEagerRelations: false,
					});
					if (
						!order ||
						order.status !== OrderStatus.DELIVERED ||
						!order.deliveredAt ||
						new Date(order.deliveredAt).getTime() > cutoff.getTime()
					) {
						return false;
					}
					await this.orderTransition.transition(manager, {
						order,
						to: OrderStatus.COMPLETED,
					});
					return true;
				});
				if (done) result.completed++;
				else result.skipped++;
			} catch (err) {
				if (err instanceof OrderVersionConflictError) {
					result.skipped++;
					continue;
				}
				result.failed++;
				this.logger.error(
					`Không hoàn tất được đơn ${candidate.id}: ${(err as Error).message}`,
				);
			}
		}
		return result;
	}
}
