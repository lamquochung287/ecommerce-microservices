import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	Unique,
} from 'typeorm';

export enum PaymentRefundStatus {
	PENDING = 'PENDING',
	SUCCEEDED = 'SUCCEEDED',
	FAILED = 'FAILED',
}

// Chỉ hoàn cả đơn, đúng một lần: unique orderId làm khoá idempotency của RefundPayment.
@Entity('payment_refunds')
@Unique(['orderId'])
export class PaymentRefund {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	orderId: string;

	@Column({ type: 'uuid', nullable: true })
	transactionId: string | null;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	amount: number;

	@Column({ type: 'enum', enum: PaymentRefundStatus })
	status: PaymentRefundStatus;

	@Column({ type: 'varchar', length: 255, nullable: true })
	reason: string | null;

	@Column({ type: 'varchar', length: 255, nullable: true })
	failureReason: string | null;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
