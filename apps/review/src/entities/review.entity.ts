import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

@Entity('reviews')
@Unique(['userId', 'productId', 'orderId'])
export class Review {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	userId: string;

	@Column({ type: 'uuid' })
	productId: string;

	@Column({ type: 'uuid' })
	orderId: string;

	@Column({ type: 'int' })
	rating: number;

	@Column({ type: 'text', nullable: true })
	comment: string | null;

	@CreateDateColumn()
	createdAt: Date;
}
