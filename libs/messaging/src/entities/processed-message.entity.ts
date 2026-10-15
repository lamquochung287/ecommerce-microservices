import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Inbox: (consumer, eventId) đã xử lý — khử trùng message at-least-once. */
@Entity('processed_messages')
export class ProcessedMessage {
	@PrimaryColumn({ type: 'varchar', length: 100 })
	consumer: string;

	@PrimaryColumn({ type: 'uuid' })
	eventId: string;

	@Column({ type: 'timestamp', default: () => 'now()' })
	processedAt: Date;
}
