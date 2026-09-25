import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, ManyToMany } from 'typeorm';
import { Attribute } from './attribute.entity';
import { ProductVariant } from './product-variant.entity';

@Entity('attribute_values')
export class AttributeValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Attribute, (attribute) => attribute.values, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attribute_id' })
  attribute: Attribute;

  @Column({ type: 'varchar', length: 255 })
  value: string;

  @ManyToMany(() => ProductVariant, (variant) => variant.attributeValues)
  variants: ProductVariant[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
