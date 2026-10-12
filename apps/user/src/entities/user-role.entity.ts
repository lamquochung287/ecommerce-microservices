import {
	Entity,
	PrimaryGeneratedColumn,
	ManyToOne,
	JoinColumn,
	CreateDateColumn,
	Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Role } from './role.entity';

@Entity('user_roles')
@Unique(['user', 'role'])
export class UserRole {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@ManyToOne(() => Role, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'role_id' })
	role: Role;

	@CreateDateColumn()
	createdAt: Date;
}
