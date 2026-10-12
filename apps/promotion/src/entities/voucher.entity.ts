import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	Unique,
} from 'typeorm';

export enum DiscountType {
	PERCENTAGE = 'PERCENTAGE',
	FIXED = 'FIXED',
}

@Entity('vouchers')
@Unique(['code'])
export class Voucher {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 50 })
	code: string;

	@Column({ type: 'enum', enum: DiscountType })
	discountType: DiscountType;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	discountValue: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	minOrderValue: number;

	@Column({ type: 'timestamp' })
	expiresAt: Date;

	@Column({ type: 'int' })
	usageLimit: number;

	@Column({ type: 'int', default: 0 })
	usageCount: number;

	@CreateDateColumn()
	createdAt: Date;
}
