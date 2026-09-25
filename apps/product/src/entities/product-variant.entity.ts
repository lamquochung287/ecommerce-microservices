import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  JoinTable,
  VersionColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { AttributeValue } from './attribute-value.entity';

@Entity('product_variants')
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product, (product) => product.variants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'varchar', length: 100, unique: true })
  sku: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number | null;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @VersionColumn()
  version: number;

  @ManyToMany(() => AttributeValue, (value) => value.variants)
  @JoinTable({
    name: 'product_variant_attribute_values',
    joinColumn: { name: 'variant_id' },
    inverseJoinColumn: { name: 'attribute_value_id' },
  })
  attributeValues: AttributeValue[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
