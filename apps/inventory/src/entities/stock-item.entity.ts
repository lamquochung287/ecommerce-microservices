import {
	Column,
	Entity,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

/**
 * Tồn kho theo (productId, variantId). `variantId = null` là dòng cấp sản phẩm.
 * available = onHand - reserved. Unique `(productId, variantId) NULLS NOT DISTINCT` và
 * CHECK (reserved >= 0 AND onHand >= reserved) nằm trong migration vì TypeORM không biểu diễn được.
 */
@Entity('stock_items')
export class StockItem {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'uuid' })
	productId: string;

	@Column({ type: 'uuid', nullable: true })
	variantId: string | null;

	@Column({ type: 'int' })
	onHand: number;

	@Column({ type: 'int', default: 0 })
	reserved: number;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
