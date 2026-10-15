import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderCancelReason } from '../../order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderVersionConflictError } from '../../order-state/order-version-conflict.error';
import { ExpirePendingOrdersCommand } from '../expire-pending-orders.command';

export interface ExpirePendingOrdersResult {
	cancelled: number;
	skipped: number;
	failed: number;
}

/**
 * Huỷ đơn PENDING_PAYMENT quá hạn thanh toán. Mỗi đơn một transaction riêng, đọc lại đơn trong transaction:
 * đơn đã đổi trạng thái hoặc lệch version (vừa được thanh toán/huỷ) thì bỏ qua, lần quét sau xử lý tiếp.
 * Lỗi của một đơn không chặn các đơn còn lại.
 */
@CommandHandler(ExpirePendingOrdersCommand)
export class ExpirePendingOrdersHandler implements ICommandHandler<ExpirePendingOrdersCommand> {
	private readonly logger = new Logger(ExpirePendingOrdersHandler.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly cancellation: OrderCancellationService,
	) {}

	async execute(
		command: ExpirePendingOrdersCommand,
	): Promise<ExpirePendingOrdersResult> {
		const result: ExpirePendingOrdersResult = {
			cancelled: 0,
			skipped: 0,
			failed: 0,
		};
		const now = new Date();
		const candidates = await this.dataSource.manager.find(Order, {
			where: {
				status: OrderStatus.PENDING_PAYMENT,
				expiresAt: LessThanOrEqual(now),
			},
			order: { expiresAt: 'ASC' },
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
						order.status !== OrderStatus.PENDING_PAYMENT ||
						!order.expiresAt ||
						new Date(order.expiresAt).getTime() > now.getTime()
					) {
						return false;
					}
					await this.cancellation.cancelUnpaid(
						manager,
						order,
						OrderCancelReason.PAYMENT_EXPIRED,
						{ releaseInventory: true },
					);
					return true;
				});
				if (done) result.cancelled++;
				else result.skipped++;
			} catch (err) {
				if (err instanceof OrderVersionConflictError) {
					result.skipped++;
					continue;
				}
				result.failed++;
				this.logger.error(
					`Không huỷ được đơn hết hạn ${candidate.id}: ${(err as Error).message}`,
				);
			}
		}
		return result;
	}
}
