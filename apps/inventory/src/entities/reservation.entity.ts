import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum ReservationStatus {
	RESERVED = 'RESERVED',
	COMMITTED = 'COMMITTED',
	RELEASED = 'RELEASED',
	EXPIRED = 'EXPIRED',
	RESTOCKED = 'RESTOCKED',
}

export interface ReservationItem {
	productId: string;
	variantId: string | null;
	quantity: number;
}

/** Mỗi đơn có tối đa một reservation (orderId unique) nên reserve/commit/release đều idempotent theo đơn. */
@Entity('reservations')
@Index('IDX_reservations_status_expiresAt', ['status', 'expiresAt'])
export class Reservation {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('UQ_reservations_orderId', { unique: true })
	@Column({ type: 'uuid' })
	orderId: string;

	@Column({ type: 'jsonb' })
	items: ReservationItem[];

	@Column({
		type: 'enum',
		enum: ReservationStatus,
		default: ReservationStatus.RESERVED,
	})
	status: ReservationStatus;

	@Column({ type: 'timestamptz' })
	expiresAt: Date;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
