import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExpireReservationsCommand } from '../commands/expire-reservations.command';

@Injectable()
export class ReservationExpiryJob {
	private readonly logger = new Logger(ReservationExpiryJob.name);
	private readonly graceSeconds: number;
	private running = false;

	constructor(
		private readonly commandBus: CommandBus,
		config: ConfigService,
	) {
		this.graceSeconds = config.get<number>(
			'INVENTORY_EXPIRY_GRACE_SECONDS',
			60,
		);
	}

	@Cron(CronExpression.EVERY_30_SECONDS)
	async run(): Promise<void> {
		// Không chạy chồng: lượt trước còn đang dọn backlog thì bỏ qua lượt này.
		if (this.running) return;
		this.running = true;
		try {
			await this.commandBus.execute(
				new ExpireReservationsCommand(this.graceSeconds),
			);
		} catch (err) {
			this.logger.error(`Expiry job lỗi: ${(err as Error).message}`);
		} finally {
			this.running = false;
		}
	}
}
