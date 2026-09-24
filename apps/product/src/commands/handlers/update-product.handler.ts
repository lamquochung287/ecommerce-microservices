import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateProductCommand } from '../update-product.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Category } from '../../entities/category.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(UpdateProductCommand)
export class UpdateProductHandler implements ICommandHandler<UpdateProductCommand> {
	constructor(
		@InjectRepository(Product) private readonly productRepository: Repository<Product>,
		@InjectRepository(Category) private readonly categoryRepository: Repository<Category>,
	) {}

	async execute(command: UpdateProductCommand) {
		const { id, dto } = command;

		const product = await this.productRepository.findOne({ where: { id } });
		if (!product) {
			throw new RpcException({ statusCode: 404, message: 'Product not found' });
		}

		if (dto.categoryId !== undefined) {
			if (dto.categoryId === null) {
				throw new RpcException({ statusCode: 400, message: 'categoryId không được để trống' });
			}
			const category = await this.categoryRepository.findOne({ where: { id: dto.categoryId } });
			if (!category) {
				throw new RpcException({ statusCode: 404, message: 'Category not found' });
			}
			product.category = category;
		}

		Object.assign(product, dto);
		delete (product as any).categoryId; // Clean up since category relation is set

		return await this.productRepository.save(product);
	}
}
