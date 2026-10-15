import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { SHIPPING_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { HandleShippingWebhookCommand } from './commands/handle-shipping-webhook.command';
import { SimulateDeliveryCommand } from './commands/simulate-delivery.command';
import { HandleShippingWebhookDto, OrderIdDto } from './dto/shipping.dto';
import { GetShipmentQuery } from './queries/get-shipment.query';

@Controller()
export class ShippingController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern(
		{ cmd: SHIPPING_MESSAGE_PATTERN.HANDLE_WEBHOOK },
		Transport.TCP,
	)
	handleWebhook(@Payload() dto: HandleShippingWebhookDto) {
		return this.commandBus.execute(new HandleShippingWebhookCommand(dto));
	}

	@MessagePattern(
		{ cmd: SHIPPING_MESSAGE_PATTERN.SIMULATE_DELIVERY },
		Transport.TCP,
	)
	simulateDelivery(@Payload() dto: OrderIdDto) {
		return this.commandBus.execute(new SimulateDeliveryCommand(dto.orderId));
	}

	@MessagePattern({ cmd: SHIPPING_MESSAGE_PATTERN.GET_SHIPMENT }, Transport.TCP)
	getShipment(@Payload() dto: OrderIdDto) {
		return this.queryBus.execute(new GetShipmentQuery(dto.orderId));
	}
}
