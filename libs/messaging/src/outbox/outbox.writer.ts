import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
	OutboxMessage,
	OutboxMessageStatus,
} from '../entities/outbox-message.entity';
import {
	MESSAGING_OPTIONS,
	MessagingModuleOptions,
} from '../messaging.constant';

export interface OutboxAppendInput {
	topic: string;
	type: string;
	orderId: string;
	payload: unknown;
}

@Injectable()
export class OutboxWriter {
	constructor(
		@Inject(MESSAGING_OPTIONS) private readonly options: MessagingModuleOptions,
	) {}

	/**
	 * Ghi message vào outbox bằng chính `manager` của transaction đang đổi state, nên event chỉ tồn tại
	 * khi state commit. Partition key luôn là orderId để Kafka giữ thứ tự theo đơn.
	 */
	async append(
		manager: EntityManager,
		input: OutboxAppendInput,
	): Promise<string> {
		const eventId = randomUUID();
		const row: QueryDeepPartialEntity<OutboxMessage> = {
			eventId,
			source: this.options.source,
			topic: input.topic,
			key: input.orderId,
			eventType: input.type,
			// jsonb: TypeORM coi Record là partial lồng nhau nên cần ép kiểu tường minh
			payload:
				input.payload as QueryDeepPartialEntity<OutboxMessage>['payload'],
			status: OutboxMessageStatus.PENDING,
		};
		await manager.insert(OutboxMessage, row);
		return eventId;
	}
}
