import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
} from 'typeorm';

export enum OutboxStatus {
	PENDING = 'PENDING',
	PUBLISHED = 'PUBLISHED',
	FAILED = 'FAILED',
}

@Entity('outbox')
export class Outbox {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 255 })
	eventType: string;

	@Column({ type: 'jsonb' })
	payload: Record<string, unknown>;

	@Column({ type: 'enum', enum: OutboxStatus, default: OutboxStatus.PENDING })
	status: OutboxStatus;

	@Column({ type: 'int', default: 0 })
	retryCount: number;

	@CreateDateColumn()
	createdAt: Date;

	@Column({ type: 'timestamp', nullable: true })
	publishedAt: Date | null;
}
