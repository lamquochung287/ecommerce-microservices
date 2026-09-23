import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
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

	@Column({ default: true })
	isActive: boolean;

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;
}