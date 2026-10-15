import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReservationService } from '../../domain/reservation.service';
import { ExpireReservationsCommand } from '../expire-reservations.command';

export const EXPIRY_BATCH_SIZE = 100;

export interface ExpireResult {
	expired: number;
	failed: number;
}

/**
 * Lưới an toàn khi Orders không release (crash/mất event): mỗi reservation hết hạn xử lý trong transaction
 * riêng nên một reservation lỗi không làm rollback hay chặn các reservation khác.
 */
@CommandHandler(ExpireReservationsCommand)
export class ExpireReservationsHandler implements ICommandHandler<ExpireReservationsCommand> {
	private readonly logger = new Logger(ExpireReservationsHandler.name);

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly reservations: ReservationService,
	) {}

	async execute(command: ExpireReservationsCommand): Promise<ExpireResult> {
		const threshold = new Date(Date.now() - command.graceSeconds * 1000);
		const total: ExpireResult = { expired: 0, failed: 0 };
		for (;;) {
			const ids = await this.reservations.findExpiredIds(
				this.dataSource.manager,
				threshold,
				EXPIRY_BATCH_SIZE,
			);
			if (ids.length === 0) break;
			let failedInBatch = 0;
			for (const id of ids) {
				try {
					const expired = await this.dataSource.transaction((manager) =>
						this.reservations.expireOne(manager, id, threshold),
					);
					if (expired) total.expired++;
				} catch (err) {
					failedInBatch++;
					total.failed++;
					this.logger.error(
						`Không hết hạn được reservation ${id}: ${(err as Error).message}`,
					);
				}
			}
			// Batch chưa đầy => đã hết việc; có lỗi => dừng để không quét lại đúng các dòng lỗi ngay lập tức.
			if (ids.length < EXPIRY_BATCH_SIZE || failedInBatch > 0) break;
		}
		return total;
	}
}
