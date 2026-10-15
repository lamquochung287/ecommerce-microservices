import { Controller } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { EventPattern, Payload, Transport } from '@nestjs/microservices';
import { KAFKA_TOPIC } from 'libs/constant/kafka.constant';
import { HandleShippingEventCommand } from '../commands/handle-shipping-event.command';

/** Controller mỏng: mọi logic nằm ở handler. Phải gắn Transport.KAFKA để pattern không bị đăng ký cho TCP. */
@Controller()
export class ShippingEventsConsumer {
	constructor(private readonly commandBus: CommandBus) {}

	@EventPattern(KAFKA_TOPIC.SHIPPING_EVENTS, Transport.KAFKA)
	async handle(@Payload() message: unknown): Promise<void> {
		await this.commandBus.execute(
			new HandleShippingEventCommand(message, KAFKA_TOPIC.SHIPPING_EVENTS),
		);
	}
}
