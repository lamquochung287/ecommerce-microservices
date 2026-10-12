import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateProductCommand } from '../update-product.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Category } from '../../entities/category.entity';
import { Brand } from '../../entities/brand.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(UpdateProductCommand)
export class UpdateProductHandler implements ICommandHandler<UpdateProductCommand> {
	constructor(
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
		@InjectRepository(Category)
		private readonly categoryRepository: Repository<Category>,
		@InjectRepository(Brand)
		private readonly brandRepository: Repository<Brand>,
	) {}

	async execute(command: UpdateProductCommand) {
		const { id, dto } = command;
		const { categoryId, brandId, ...rest } = dto;

		const product = await this.productRepository.findOne({ where: { id } });
		if (!product) {
			throw new RpcException({ statusCode: 404, message: 'Product not found' });
		}

		if (categoryId !== undefined) {
			if (categoryId === null) {
				throw new RpcException({
					statusCode: 400,
					message: 'categoryId không được để trống',
				});
			}
			const category = await this.categoryRepository.findOne({
				where: { id: categoryId },
			});
			if (!category) {
				throw new RpcException({
					statusCode: 404,
					message: 'Category not found',
				});
			}
			product.category = category;
		}

		if (brandId !== undefined) {
			if (brandId === null) {
				product.brand = null as any;
			} else {
				const brand = await this.brandRepository.findOne({
					where: { id: brandId },
				});
				if (!brand) {
					throw new RpcException({
						statusCode: 404,
						message: 'Brand not found',
					});
				}
				product.brand = brand;
			}
		}

		Object.assign(product, rest);

		return await this.productRepository.save(product);
	}
}
