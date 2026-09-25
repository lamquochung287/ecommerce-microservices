import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('addresses')
export class Address {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

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

	@Column({ type: 'boolean', default: false })
	isDefault: boolean;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}
