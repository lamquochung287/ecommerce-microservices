import { Controller } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { EventPattern, Payload, Transport } from '@nestjs/microservices';
import { KAFKA_TOPIC } from 'libs/constant/kafka.constant';
import { HandlePaymentEventCommand } from '../commands/handle-payment-event.command';

/** Controller mỏng: mọi logic nằm ở handler. Phải gắn Transport.KAFKA để pattern không bị đăng ký cho TCP. */
@Controller()
export class PaymentEventsConsumer {
	constructor(private readonly commandBus: CommandBus) {}

	@EventPattern(KAFKA_TOPIC.PAYMENT_EVENTS, Transport.KAFKA)
	async handle(@Payload() message: unknown): Promise<void> {
		await this.commandBus.execute(
			new HandlePaymentEventCommand(message, KAFKA_TOPIC.PAYMENT_EVENTS),
		);
	}
}
