import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateProductCommand } from './commands/create-product.command';
import { UpdateProductCommand } from './commands/update-product.command';
import { DeleteProductCommand } from './commands/delete-product.command';
import { CreateBrandCommand } from './commands/create-brand.command';
import { UpdateBrandCommand } from './commands/update-brand.command';
import { DeleteBrandCommand } from './commands/delete-brand.command';
import { CreateAttributeCommand } from './commands/create-attribute.command';
import { UpdateAttributeCommand } from './commands/update-attribute.command';
import { DeleteAttributeCommand } from './commands/delete-attribute.command';
import { CreateVariantCommand } from './commands/create-variant.command';
import { UpdateVariantCommand } from './commands/update-variant.command';
import { DeleteVariantCommand } from './commands/delete-variant.command';
import { AdjustStockCommand } from './commands/adjust-stock.command';
import { GetProductsQuery } from './queries/get-products.query';
import { GetProductQuery } from './queries/get-product.query';
import { GetBrandsQuery } from './queries/get-brands.query';
import { GetAttributesQuery } from './queries/get-attributes.query';
import { GetVariantsQuery } from './queries/get-variants.query';
import {
	CreateProductDto,
	GetProductsFilterDto,
	UpdateProductDto,
} from './dto/product.dto';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import { CreateAttributeDto, UpdateAttributeDto } from './dto/attribute.dto';
import {
	AdjustStockDto,
	CreateVariantDto,
	UpdateVariantDto,
} from './dto/product-variant.dto';

@Controller()
export class ProductController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.CREATE_PRODUCT })
	async createProduct(@Payload() dto: CreateProductDto) {
		return this.commandBus.execute(new CreateProductCommand(dto));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCTS })
	async getProducts(@Payload() payload: GetProductsFilterDto) {
		return this.queryBus.execute(
			new GetProductsQuery(
				payload?.page || 1,
				payload?.limit || 20,
				payload?.sortBy || 'createdAt',
				payload?.sortOrder || 'DESC',
				payload?.categoryId,
				payload?.brandId,
				payload?.minPrice,
				payload?.maxPrice,
				payload?.isActive,
				payload?.search,
			),
		);
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCT })
	async getProduct(@Payload() data: { id: string }) {
		return this.queryBus.execute(new GetProductQuery(data.id));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_PRODUCT })
	async updateProduct(
		@Payload() payload: { id: string; dto: UpdateProductDto },
	) {
		return this.commandBus.execute(
			new UpdateProductCommand(payload.id, payload.dto),
		);
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.DELETE_PRODUCT })
	async deleteProduct(@Payload() data: { id: string }) {
		return this.commandBus.execute(new DeleteProductCommand(data.id));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.ADJUST_STOCK })
	async adjustStock(@Payload() dto: AdjustStockDto) {
		return this.commandBus.execute(new AdjustStockCommand(dto));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.CREATE_BRAND })
	async createBrand(@Payload() dto: CreateBrandDto) {
		return this.commandBus.execute(new CreateBrandCommand(dto));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.GET_BRANDS })
	async getBrands() {
		return this.queryBus.execute(new GetBrandsQuery());
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_BRAND })
	async updateBrand(@Payload() payload: { id: string; dto: UpdateBrandDto }) {
		return this.commandBus.execute(
			new UpdateBrandCommand(payload.id, payload.dto),
		);
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.DELETE_BRAND })
	async deleteBrand(@Payload() data: { id: string }) {
		return this.commandBus.execute(new DeleteBrandCommand(data.id));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.CREATE_ATTRIBUTE })
	async createAttribute(@Payload() dto: CreateAttributeDto) {
		return this.commandBus.execute(new CreateAttributeCommand(dto));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.GET_ATTRIBUTES })
	async getAttributes() {
		return this.queryBus.execute(new GetAttributesQuery());
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_ATTRIBUTE })
	async updateAttribute(
		@Payload() payload: { id: string; dto: UpdateAttributeDto },
	) {
		return this.commandBus.execute(
			new UpdateAttributeCommand(payload.id, payload.dto),
		);
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.DELETE_ATTRIBUTE })
	async deleteAttribute(@Payload() data: { id: string }) {
		return this.commandBus.execute(new DeleteAttributeCommand(data.id));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.CREATE_VARIANT })
	async createVariant(@Payload() dto: CreateVariantDto) {
		return this.commandBus.execute(new CreateVariantCommand(dto));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.GET_VARIANTS })
	async getVariants(@Payload() data: { productId: string }) {
		return this.queryBus.execute(new GetVariantsQuery(data.productId));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_VARIANT })
	async updateVariant(
		@Payload() payload: { id: string; dto: UpdateVariantDto },
	) {
		return this.commandBus.execute(
			new UpdateVariantCommand(payload.id, payload.dto),
		);
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.DELETE_VARIANT })
	async deleteVariant(@Payload() data: { id: string }) {
		return this.commandBus.execute(new DeleteVariantCommand(data.id));
	}
}
