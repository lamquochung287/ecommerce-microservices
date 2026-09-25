import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

export enum PaymentTransactionStatus {
	SUCCEEDED = 'SUCCEEDED',
	FAILED = 'FAILED',
}

@Entity('payment_transactions')
@Unique(['idempotencyKey'])
export class PaymentTransaction {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	orderId: string;

	@Column({ type: 'varchar', length: 255 })
	idempotencyKey: string;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	amount: number;

	@Column({ type: 'enum', enum: PaymentTransactionStatus })
	status: PaymentTransactionStatus;

	@Column({ type: 'varchar', length: 255, nullable: true })
	failureReason: string | null;

	@CreateDateColumn()
	createdAt: Date;
}
