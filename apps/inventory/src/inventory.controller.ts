import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { INVENTORY_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { AdjustStockCommand } from './commands/adjust-stock.command';
import { ReleaseReservationCommand } from './commands/release-reservation.command';
import { ReserveStockCommand } from './commands/reserve-stock.command';
import {
	AdjustStockDto,
	GetAvailabilityDto,
	OrderIdDto,
	ReserveStockDto,
} from './dto/inventory.dto';
import { CheckReservationQuery } from './queries/check-reservation.query';
import { GetAvailabilityQuery } from './queries/get-availability.query';

@Controller()
export class InventoryController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: INVENTORY_MESSAGE_PATTERN.RESERVE }, Transport.TCP)
	reserve(@Payload() dto: ReserveStockDto) {
		return this.commandBus.execute(new ReserveStockCommand(dto));
	}

	@MessagePattern(
		{ cmd: INVENTORY_MESSAGE_PATTERN.CHECK_RESERVATION },
		Transport.TCP,
	)
	checkReservation(@Payload() dto: OrderIdDto) {
		return this.queryBus.execute(new CheckReservationQuery(dto.orderId));
	}

	@MessagePattern({ cmd: INVENTORY_MESSAGE_PATTERN.RELEASE }, Transport.TCP)
	release(@Payload() dto: OrderIdDto) {
		return this.commandBus.execute(new ReleaseReservationCommand(dto.orderId));
	}

	@MessagePattern(
		{ cmd: INVENTORY_MESSAGE_PATTERN.ADJUST_STOCK },
		Transport.TCP,
	)
	adjustStock(@Payload() dto: AdjustStockDto) {
		return this.commandBus.execute(new AdjustStockCommand(dto));
	}

	@MessagePattern(
		{ cmd: INVENTORY_MESSAGE_PATTERN.GET_AVAILABILITY },
		Transport.TCP,
	)
	getAvailability(@Payload() dto: GetAvailabilityDto) {
		return this.queryBus.execute(new GetAvailabilityQuery(dto.productIds));
	}
}
