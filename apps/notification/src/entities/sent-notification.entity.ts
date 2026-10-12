import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
} from 'typeorm';

export enum NotificationChannel {
	EMAIL = 'EMAIL',
	PUSH = 'PUSH',
}

export enum NotificationStatus {
	SENT = 'SENT',
	FAILED = 'FAILED',
}

@Entity('sent_notifications')
export class SentNotification {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'enum', enum: NotificationChannel })
	channel: NotificationChannel;

	@Column({ type: 'varchar', length: 255 })
	recipient: string;

	@Column({ type: 'varchar', length: 255 })
	subject: string;

	@Column({ type: 'text' })
	body: string;

	@Column({ type: 'enum', enum: NotificationStatus })
	status: NotificationStatus;

	@Column({ type: 'varchar', length: 255, nullable: true })
	sourceEvent: string | null;

	@CreateDateColumn()
	createdAt: Date;
}
