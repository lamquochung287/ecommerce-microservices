import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReservationService } from '../../domain/reservation.service';
import { CheckReservationQuery } from '../check-reservation.query';

@QueryHandler(CheckReservationQuery)
export class CheckReservationHandler implements IQueryHandler<CheckReservationQuery> {
	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly reservations: ReservationService,
	) {}

	execute(query: CheckReservationQuery) {
		return this.reservations.check(this.dataSource.manager, query.orderId);
	}
}
