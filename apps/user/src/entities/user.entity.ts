import {
	Entity,
	Column,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	Generated,
	Index,
} from 'typeorm';

@Entity('users')
export class User {
	@PrimaryGeneratedColumn()
	id: number;

	@Index()
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
