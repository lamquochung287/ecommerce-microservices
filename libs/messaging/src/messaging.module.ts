import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaConsumerRunner } from './consumer/kafka-consumer.runner';
import { OutboxMessage } from './entities/outbox-message.entity';
import { ProcessedMessage } from './entities/processed-message.entity';
import { InboxService } from './inbox/inbox.service';
import { KafkaProducerService } from './kafka/kafka-producer.service';
import {
	MESSAGING_OPTIONS,
	MessagingModuleOptions,
} from './messaging.constant';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { OutboxWriter } from './outbox/outbox.writer';

@Module({})
export class MessagingModule {
	/** Yêu cầu app đã có TypeOrmModule.forRoot (DatabaseModule) và ConfigModule global. */
	static forService(options: MessagingModuleOptions): DynamicModule {
		const providers: Provider[] = [
			{ provide: MESSAGING_OPTIONS, useValue: options },
			KafkaProducerService,
			OutboxWriter,
			InboxService,
			KafkaConsumerRunner,
		];
		if (options.relay !== false) providers.push(OutboxRelayService);

		return {
			module: MessagingModule,
			imports: [TypeOrmModule.forFeature([OutboxMessage, ProcessedMessage])],
			providers,
			exports: [
				KafkaProducerService,
				OutboxWriter,
				InboxService,
				KafkaConsumerRunner,
			],
		};
	}
}
