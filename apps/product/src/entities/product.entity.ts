import {
	Entity,
	PrimaryGeneratedColumn,
	Column,
	CreateDateColumn,
	UpdateDateColumn,
	DeleteDateColumn,
	ManyToOne,
	JoinColumn,
	OneToMany,
	VersionColumn,
} from 'typeorm';
import { Category } from './category.entity';
import { Brand } from './brand.entity';
import { ProductVariant } from './product-variant.entity';

@Entity('products')
export class Product {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 255 })
	name: string;

	@Column({ type: 'varchar', length: 255, unique: true })
	slug: string;

	@Column({ type: 'text' })
	description: string;

	@Column({ type: 'decimal', precision: 10, scale: 2 })
	price: number;

	@Column({ type: 'int', default: 0 })
	stock: number;

	@Column({ type: 'int', default: 10 })
	lowStockThreshold: number;

	@VersionColumn()
	version: number;

	@Column({ type: 'boolean', default: true })
	isActive: boolean;

	@Column({ type: 'jsonb', default: () => "'[]'" })
	images: string[];

	@ManyToOne(() => Category, (category) => category.products, {
		nullable: true,
	})
	@JoinColumn({ name: 'category_id' })
	category: Category;

	@ManyToOne(() => Brand, (brand) => brand.products, { nullable: true })
	@JoinColumn({ name: 'brand_id' })
	brand: Brand;

	@OneToMany(() => ProductVariant, (variant) => variant.product)
	variants: ProductVariant[];

	@CreateDateColumn()
	createdAt: Date;

	@UpdateDateColumn()
	updatedAt: Date;

	@DeleteDateColumn()
	deletedAt: Date | null;
}
