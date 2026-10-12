import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { CreateProductCommand } from '../create-product.command';
import { ProductCreatedEvent } from '../../events/product-created.event';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Category } from '../../entities/category.entity';
import { Brand } from '../../entities/brand.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(CreateProductCommand)
export class CreateProductHandler implements ICommandHandler<CreateProductCommand> {
	constructor(
		private readonly eventBus: EventBus,
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
		@InjectRepository(Category)
		private readonly categoryRepository: Repository<Category>,
		@InjectRepository(Brand)
		private readonly brandRepository: Repository<Brand>,
	) {}

	async execute(command: CreateProductCommand) {
		const { dto } = command;
		const { categoryId, brandId, ...rest } = dto;

		const category = await this.categoryRepository.findOne({
			where: { id: categoryId },
		});
		if (!category) {
			throw new RpcException({
				statusCode: 404,
				message: 'Category not found',
			});
		}

		let brand: Brand | null = null;
		if (brandId) {
			brand = await this.brandRepository.findOne({ where: { id: brandId } });
			if (!brand) {
				throw new RpcException({ statusCode: 404, message: 'Brand not found' });
			}
		}

		const product = this.productRepository.create({
			...rest,
			category,
			brand: brand ?? undefined,
		});

		const savedProduct = await this.productRepository.save(product);

		// Publish event to EventBus
		this.eventBus.publish(
			new ProductCreatedEvent(
				savedProduct.id,
				savedProduct.name,
				savedProduct.price,
			),
		);

		return savedProduct;
	}
}
