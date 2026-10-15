import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
} from 'typeorm';

export enum OutboxMessageStatus {
	PENDING = 'PENDING',
	PUBLISHED = 'PUBLISHED',
	FAILED = 'FAILED',
}

/**
 * Bảng outbox dùng chung; mỗi service chỉ relay row có `source` của mình.
 * `source` và `topic` bắt buộc do OutboxWriter điền; không có default để ghi thiếu sẽ lỗi thay vì lệch topic.
 */
@Entity('outbox')
@Index('IDX_outbox_relay', ['status', 'source', 'seq'])
@Index('IDX_outbox_key_status', ['key', 'status'])
export class OutboxMessage {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	/** Thứ tự ghi toàn cục; dùng thay createdAt vì createdAt trùng nhau trong cùng transaction. */
	@Column({ type: 'bigint', generated: 'increment' })
	seq: string;

	@Index('UQ_outbox_eventId', { unique: true })
	@Column({ type: 'uuid', default: () => 'uuid_generate_v4()' })
	eventId: string;

	@Column({ type: 'varchar', length: 50 })
	source: string;

	@Column({ type: 'varchar', length: 100 })
	topic: string;

	/** Partition key Kafka (= orderId) để giữ thứ tự theo đơn. */
	@Column({ type: 'varchar', length: 100, nullable: true })
	key: string | null;

	@Column({ type: 'varchar', length: 255 })
	eventType: string;

	@Column({ type: 'jsonb' })
	payload: Record<string, unknown>;

	@Column({
		type: 'enum',
		enum: OutboxMessageStatus,
		enumName: 'outbox_status_enum',
		default: OutboxMessageStatus.PENDING,
	})
	status: OutboxMessageStatus;

	@Column({ type: 'int', default: 0 })
	retryCount: number;

	@Column({ type: 'timestamp', default: () => 'now()' })
	nextAttemptAt: Date;

	@Column({ type: 'text', nullable: true })
	lastError: string | null;

	@CreateDateColumn()
	createdAt: Date;

	@Column({ type: 'timestamp', nullable: true })
	publishedAt: Date | null;
}
