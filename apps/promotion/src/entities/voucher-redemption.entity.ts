import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum VoucherRedemptionStatus {
	RESERVED = 'RESERVED',
	CONFIRMED = 'CONFIRMED',
	RELEASED = 'RELEASED',
}

/**
 * Một lượt dùng voucher gắn với đúng một đơn (orderId unique) nên reserve/release idempotent theo đơn.
 * RESERVED giữ một lượt trong `vouchers.usageCount`; CONFIRMED = đơn đã thanh toán (lượt không bao giờ trả);
 * RELEASED = đã trả lượt (đơn chưa thanh toán bị huỷ/hết hạn/thay thế).
 */
@Entity('voucher_redemptions')
export class VoucherRedemption {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('IDX_voucher_redemptions_voucherId')
	@Column({ type: 'uuid' })
	voucherId: string;

	@Column({ type: 'varchar', length: 50 })
	code: string;

	@Index('UQ_voucher_redemptions_orderId', { unique: true })
	@Column({ type: 'uuid' })
	orderId: string;

	@Column({ type: 'uuid' })
	userId: string;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	discountAmount: number;

	@Column({
		type: 'enum',
		enum: VoucherRedemptionStatus,
		default: VoucherRedemptionStatus.RESERVED,
	})
	status: VoucherRedemptionStatus;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
