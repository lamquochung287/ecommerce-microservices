import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductController } from './product.controller';
import { CreateProductHandler } from './commands/handlers/create-product.handler';
import { UpdateProductHandler } from './commands/handlers/update-product.handler';
import { DeleteProductHandler } from './commands/handlers/delete-product.handler';
import { CreateBrandHandler } from './commands/handlers/create-brand.handler';
import { UpdateBrandHandler } from './commands/handlers/update-brand.handler';
import { DeleteBrandHandler } from './commands/handlers/delete-brand.handler';
import { CreateAttributeHandler } from './commands/handlers/create-attribute.handler';
import { UpdateAttributeHandler } from './commands/handlers/update-attribute.handler';
import { DeleteAttributeHandler } from './commands/handlers/delete-attribute.handler';
import { CreateVariantHandler } from './commands/handlers/create-variant.handler';
import { UpdateVariantHandler } from './commands/handlers/update-variant.handler';
import { DeleteVariantHandler } from './commands/handlers/delete-variant.handler';
import { GetProductsHandler } from './queries/handlers/get-products.handler';
import { GetProductHandler } from './queries/handlers/get-product.handler';
import { GetBrandsHandler } from './queries/handlers/get-brands.handler';
import { GetAttributesHandler } from './queries/handlers/get-attributes.handler';
import { GetVariantsHandler } from './queries/handlers/get-variants.handler';
import { ProductCreatedHandler } from './events/handlers/product-created.handler';
import { Product } from './entities/product.entity';
import { Category } from './entities/category.entity';
import { Brand } from './entities/brand.entity';
import { Attribute } from './entities/attribute.entity';
import { AttributeValue } from './entities/attribute-value.entity';
import { ProductVariant } from './entities/product-variant.entity';

import { DatabaseModule } from '@lib/database';
import { CachedModule } from '@lib/cached';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [
	CreateProductHandler,
	UpdateProductHandler,
	DeleteProductHandler,
	CreateBrandHandler,
	UpdateBrandHandler,
	DeleteBrandHandler,
	CreateAttributeHandler,
	UpdateAttributeHandler,
	DeleteAttributeHandler,
	CreateVariantHandler,
	UpdateVariantHandler,
	DeleteVariantHandler,
];
export const QueryHandlers = [
	GetProductsHandler,
	GetProductHandler,
	GetBrandsHandler,
	GetAttributesHandler,
	GetVariantsHandler,
];
export const EventHandlers = [ProductCreatedHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		CachedModule,
		TypeOrmModule.forFeature([
			Product,
			Category,
			Brand,
			Attribute,
			AttributeValue,
			ProductVariant,
		]),
		CqrsModule,
		HealthModule,
	],
	controllers: [ProductController],
	providers: [...CommandHandlers, ...QueryHandlers, ...EventHandlers],
})
export class ProductModule {}
