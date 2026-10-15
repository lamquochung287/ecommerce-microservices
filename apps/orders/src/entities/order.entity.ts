import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	DeleteDateColumn,
	OneToMany,
	Index,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { Refund } from './refund.entity';

export enum OrderStatus {
	PENDING_PAYMENT = 'PENDING_PAYMENT',
	FULFILLING = 'FULFILLING',
	COMPLETED = 'COMPLETED',
	REFUNDING = 'REFUNDING',
	PAID = 'PAID',
	SHIPPED = 'SHIPPED',
	DELIVERED = 'DELIVERED',
	CANCELLED = 'CANCELLED',
	REFUNDED = 'REFUNDED',
}

// Trạng thái hoàn tiền chỉ để hiển thị, không ảnh hưởng state machine của đơn.
export enum OrderRefundStatus {
	NONE = 'NONE',
	PENDING = 'PENDING',
	SUCCEEDED = 'SUCCEEDED',
	FAILED = 'FAILED',
}

@Entity('orders')
@Index('IDX_orders_status_expires', ['status', 'expiresAt'])
@Index('IDX_orders_status_delivered', ['status', 'deliveredAt'])
@Index('IDX_orders_user_status', ['userId', 'status'])
export class Order {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	userId: string; // From User Microservice

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	subtotal: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	taxAmount: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	shippingFee: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	totalAmount: number;

	@Column({
		type: 'enum',
		enum: OrderStatus,
		default: OrderStatus.PENDING_PAYMENT,
	})
	status: OrderStatus;

	// Khoá lạc quan: mọi đổi state phải UPDATE ... WHERE version = :v (xem OrderTransitionService).
	@Column({ type: 'int', default: 1 })
	version: number;

	@Column({ type: 'timestamptz', nullable: true })
	expiresAt: Date | null;

	@Column({ type: 'timestamptz', nullable: true })
	paidAt: Date | null;

	@Column({ type: 'timestamptz', nullable: true })
	deliveredAt: Date | null;

	@Column({ type: 'varchar', length: 40, nullable: true })
	cancelReason: string | null;

	@Column({
		type: 'enum',
		enum: OrderRefundStatus,
		default: OrderRefundStatus.NONE,
	})
	refundStatus: OrderRefundStatus;

	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
	refundedAmount: number | null;

	@Column({ type: 'timestamptz', nullable: true })
	refundedAt: Date | null;

	@Column({ type: 'uuid', nullable: true })
	paymentIntentId: string | null;

	@Column({ type: 'varchar', length: 500, nullable: true })
	paymentCheckoutUrl: string | null;

	@Column({ type: 'varchar', length: 100, nullable: true })
	trackingCode: string | null;

	@Column({ type: 'varchar', length: 50, nullable: true })
	voucherCode: string | null;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	discountAmount: number;

	// Snapshot địa chỉ giao hàng tại thời điểm đặt hàng (không FK sang Address Book của User service)
	@Column({ type: 'varchar', length: 255 })
	recipientName: string;

	@Column({ type: 'varchar', length: 30 })
	recipientPhone: string;

	@Column({ type: 'varchar', length: 255 })
	addressLine1: string;

	@Column({ type: 'varchar', length: 255, nullable: true })
	addressLine2: string | null;

	@Column({ type: 'varchar', length: 120 })
	city: string;

	@Column({ type: 'varchar', length: 120, nullable: true })
	province: string | null;

	@Column({ type: 'varchar', length: 20, nullable: true })
	postalCode: string | null;

	@Column({ type: 'varchar', length: 100 })
	country: string;

	@OneToMany(() => OrderItem, (item) => item.order, {
		cascade: true,
		eager: true,
	})
	items: OrderItem[];

	@OneToMany(() => Refund, (refund) => refund.order)
	refunds: Refund[];

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@DeleteDateColumn()
	deletedAt: Date | null;
}
