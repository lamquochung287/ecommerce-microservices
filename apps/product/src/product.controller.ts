import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateProductCommand } from './commands/create-product.command';
import { UpdateProductCommand } from './commands/update-product.command';
import { DeleteProductCommand } from './commands/delete-product.command';
import { GetProductsQuery } from './queries/get-products.query';
import { GetProductQuery } from './queries/get-product.query';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

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
	async getProducts() {
		return this.queryBus.execute(new GetProductsQuery());
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCT })
	async getProduct(@Payload() data: { id: string }) {
		return this.queryBus.execute(new GetProductQuery(data.id));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_PRODUCT })
	async updateProduct(@Payload() payload: { id: string; dto: UpdateProductDto }) {
		return this.commandBus.execute(new UpdateProductCommand(payload.id, payload.dto));
	}

	@MessagePattern({ cmd: PRODUCT_MESSAGE_PATTERN.DELETE_PRODUCT })
	async deleteProduct(@Payload() data: { id: string }) {
		return this.commandBus.execute(new DeleteProductCommand(data.id));
	}
}
