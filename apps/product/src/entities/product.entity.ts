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
	Index,
} from 'typeorm';
import { Category } from './category.entity';
import { Brand } from './brand.entity';
import { ProductVariant } from './product-variant.entity';

@Entity('products')
// Phục vụ GET /products (ORDER BY createdAt DESC, id LIMIT/OFFSET): tránh Seq Scan + Sort toàn bảng.
// Index thật ("createdAt" DESC, "id") WHERE "deletedAt" IS NULL được tạo trong migration vì TypeORM không
// biểu diễn được thứ tự cột; synchronize:false để migration:generate / schema:sync không xoá nó.
@Index('IDX_products_created_at_id', { synchronize: false })
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
