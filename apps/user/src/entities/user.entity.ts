import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	DeleteDateColumn,
	Generated,
	Index,
	Unique,
} from 'typeorm';

@Entity('users')
export class User {
	@PrimaryGeneratedColumn()
	@Index()
	id: number;

	@Column()
	@Generated('uuid')
	userId: string;

	@Column({ unique: true })
	email: string;

	@Column()
	password: string;

	@Column({ nullable: true })
	fullName: string;

	@Column({ type: 'varchar', nullable: true })
	avatarUrl: string | null;

	@Column({ type: 'bigint', default: 0 })
	permissions: number;

	@Column({ default: true })
	isActive: boolean;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@DeleteDateColumn()
	deletedAt: Date | null;
}
