import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReservationService } from '../../domain/reservation.service';
import { ReserveStockCommand } from '../reserve-stock.command';

@CommandHandler(ReserveStockCommand)
export class ReserveStockHandler implements ICommandHandler<ReserveStockCommand> {
	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly reservations: ReservationService,
	) {}

	execute(command: ReserveStockCommand) {
		return this.dataSource.transaction((manager) =>
			this.reservations.reserve(manager, command.dto),
		);
	}
}
