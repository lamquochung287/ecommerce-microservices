import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	Unique,
	Index,
} from 'typeorm';

export enum PaymentTransactionStatus {
	PENDING = 'PENDING',
	SUCCEEDED = 'SUCCEEDED',
	FAILED = 'FAILED',
	CANCELLED = 'CANCELLED',
}

// Một dòng = một payment intent của đơn (idempotencyKey = orderId).
@Entity('payment_transactions')
@Unique(['idempotencyKey'])
@Index('IDX_payment_transactions_orderId', ['orderId'])
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

	// Hạn thanh toán của intent: không dài hơn thời hạn giữ hàng do Orders gửi.
	@Column({ type: 'timestamptz', nullable: true })
	expiresAt: Date | null;

	@Column({ type: 'varchar', length: 500, nullable: true })
	checkoutUrl: string | null;

	@Column({ type: 'timestamptz', nullable: true })
	paidAt: Date | null;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
