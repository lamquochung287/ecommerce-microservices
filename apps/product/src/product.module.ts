import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductController } from './product.controller';
import { CreateProductHandler } from './commands/handlers/create-product.handler';
import { UpdateProductHandler } from './commands/handlers/update-product.handler';
import { DeleteProductHandler } from './commands/handlers/delete-product.handler';
import { GetProductsHandler } from './queries/handlers/get-products.handler';
import { GetProductHandler } from './queries/handlers/get-product.handler';
import { ProductCreatedHandler } from './events/handlers/product-created.handler';
import { Product } from './entities/product.entity';
import { Category } from './entities/category.entity';

import { DatabaseModule } from '@lib/database';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';

export const CommandHandlers = [
	CreateProductHandler,
	UpdateProductHandler,
	DeleteProductHandler,
];
export const QueryHandlers = [GetProductsHandler, GetProductHandler];
export const EventHandlers = [ProductCreatedHandler];

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([Product, Category]),
		CqrsModule,
		HealthModule,
	],
	controllers: [ProductController],
	providers: [
		...CommandHandlers,
		...QueryHandlers,
		...EventHandlers,
	],
})
export class ProductModule {}
