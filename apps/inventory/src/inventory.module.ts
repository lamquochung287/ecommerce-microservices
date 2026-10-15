import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonConfigModule } from '@lib/common';
import { DatabaseModule } from '@lib/database';
import { MessagingModule } from '@lib/messaging';
import { OUTBOX_SOURCE } from 'libs/constant/kafka.constant';
import { AdjustStockHandler } from './commands/handlers/adjust-stock.handler';
import { ExpireReservationsHandler } from './commands/handlers/expire-reservations.handler';
import { HandleInventoryCommandMessageHandler } from './commands/handlers/handle-inventory-command-message.handler';
import { ReleaseReservationHandler } from './commands/handlers/release-reservation.handler';
import { ReserveStockHandler } from './commands/handlers/reserve-stock.handler';
import { ReservationService } from './domain/reservation.service';
import { Reservation } from './entities/reservation.entity';
import { StockItem } from './entities/stock-item.entity';
import { HealthModule } from './health/health.module';
import { InventoryController } from './inventory.controller';
import { ReservationExpiryJob } from './jobs/reservation-expiry.job';
import { InventoryCommandsConsumer } from './messaging/inventory-commands.consumer';
import { CheckReservationHandler } from './queries/handlers/check-reservation.handler';
import { GetAvailabilityHandler } from './queries/handlers/get-availability.handler';

export const CommandHandlers = [
	ReserveStockHandler,
	ReleaseReservationHandler,
	AdjustStockHandler,
	ExpireReservationsHandler,
	HandleInventoryCommandMessageHandler,
];
export const QueryHandlers = [CheckReservationHandler, GetAvailabilityHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([StockItem, Reservation]),
		CqrsModule,
		ScheduleModule.forRoot(),
		HealthModule,
		MessagingModule.forService({ source: OUTBOX_SOURCE.INVENTORY }),
	],
	controllers: [InventoryController, InventoryCommandsConsumer],
	providers: [
		ReservationService,
		ReservationExpiryJob,
		...CommandHandlers,
		...QueryHandlers,
	],
})
export class InventoryModule {}
