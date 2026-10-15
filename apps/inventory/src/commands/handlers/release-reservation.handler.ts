import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReservationService } from '../../domain/reservation.service';
import { ReleaseReservationCommand } from '../release-reservation.command';

@CommandHandler(ReleaseReservationCommand)
export class ReleaseReservationHandler implements ICommandHandler<ReleaseReservationCommand> {
	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly reservations: ReservationService,
	) {}

	execute(command: ReleaseReservationCommand) {
		return this.dataSource.transaction((manager) =>
			this.reservations.release(manager, command.orderId),
		);
	}
}
