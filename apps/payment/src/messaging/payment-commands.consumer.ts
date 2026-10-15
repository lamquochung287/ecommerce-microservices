import { Controller, Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { EventPattern, Payload, Transport } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
	KafkaConsumerRunner,
	MessageEnvelope,
	OutboxWriter,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import { HandlePaymentCommandMessageCommand } from '../commands/handle-payment-command-message.command';

// Consumer mỏng cho payment-commands: inbox + transaction + retry/DLQ do KafkaConsumerRunner lo.
@Controller()
export class PaymentCommandsConsumer {
	private readonly logger = new Logger(PaymentCommandsConsumer.name);

	constructor(
		private readonly runner: KafkaConsumerRunner,
		private readonly commandBus: CommandBus,
		private readonly outbox: OutboxWriter,
		@InjectDataSource() private readonly dataSource: DataSource,
	) {}

	@EventPattern(KAFKA_TOPIC.PAYMENT_COMMANDS, Transport.KAFKA)
	async onPaymentCommand(@Payload() message: unknown): Promise<void> {
		await this.runner.run({
			consumer: CONSUMER_GROUP.PAYMENT,
			topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
			message,
			handle: async (manager, envelope) => {
				await this.commandBus.execute(
					new HandlePaymentCommandMessageCommand(manager, envelope),
				);
			},
			onExhausted: (envelope, error) => this.onExhausted(envelope, error),
		});
	}

	// RefundPayment hết lượt retry: báo thất bại về Orders để refundStatus không kẹt ở PENDING.
	// Các command khác không có kết quả để báo ngược.
	private async onExhausted(
		envelope: MessageEnvelope,
		error: Error,
	): Promise<void> {
		if (envelope.type !== MESSAGE_TYPE.REFUND_PAYMENT) return;
		this.logger.error(
			`RefundPayment for order ${envelope.orderId} failed permanently: ${error.message}`,
		);
		await this.dataSource.transaction((manager) =>
			this.outbox.append(manager, {
				topic: KAFKA_TOPIC.PAYMENT_EVENTS,
				type: MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
				orderId: envelope.orderId,
				payload: {
					reason: `Refund processing failed: ${error.message}`.slice(0, 255),
				},
			}),
		);
	}
}
