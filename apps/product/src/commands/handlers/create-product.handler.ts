import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { CreateProductCommand } from '../create-product.command';
import { ProductCreatedEvent } from '../../events/product-created.event';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { Category } from '../../entities/category.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(CreateProductCommand)
export class CreateProductHandler implements ICommandHandler<CreateProductCommand> {
	constructor(
		private readonly eventBus: EventBus,
		@InjectRepository(Product) private readonly productRepository: Repository<Product>,
		@InjectRepository(Category) private readonly categoryRepository: Repository<Category>,
	) {}

	async execute(command: CreateProductCommand) {
		const { dto } = command;
		
		const category = await this.categoryRepository.findOne({ where: { id: dto.categoryId } });
		if (!category) {
			throw new RpcException({ statusCode: 404, message: 'Category not found' });
		}

		const product = this.productRepository.create({
			...dto,
			category,
		});

		const savedProduct = await this.productRepository.save(product);
		
		// Publish event to EventBus
		this.eventBus.publish(new ProductCreatedEvent(savedProduct.id, savedProduct.name, savedProduct.price));
		
		return savedProduct;
	}
}
