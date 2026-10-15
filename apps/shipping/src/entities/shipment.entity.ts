import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum ShipmentStatus {
	CREATED = 'CREATED',
	DELIVERED = 'DELIVERED',
	CANCELLED = 'CANCELLED',
	FAILED = 'FAILED',
}

/** Mỗi đơn có tối đa một vận đơn (orderId unique) nên CreateShipment idempotent theo đơn. */
@Entity('shipments')
export class Shipment {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('UQ_shipments_orderId', { unique: true })
	@Column({ type: 'uuid' })
	orderId: string;

	@Column({
		type: 'enum',
		enum: ShipmentStatus,
		default: ShipmentStatus.CREATED,
	})
	status: ShipmentStatus;

	@Column({ type: 'varchar', length: 100, nullable: true })
	trackingCode: string | null;

	@Column({ type: 'varchar', length: 50, nullable: true })
	carrier: string | null;

	@Column({ type: 'varchar', length: 500, nullable: true })
	failureReason: string | null;

	@Column({ type: 'timestamptz', nullable: true })
	deliveredAt: Date | null;

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
