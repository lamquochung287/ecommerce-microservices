import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { BrandController } from './brand.controller';
import { AttributeController } from './attribute.controller';
import { VariantController } from './variant.controller';
import { ProductService } from './product.service';
import { InventoryService } from './inventory.service';

@Module({
	imports: [],
	controllers: [
		ProductController,
		BrandController,
		AttributeController,
		VariantController,
	],
	providers: [ProductService, InventoryService],
	exports: [ProductService],
})
export class ProductModule {}
