import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateVariantCommand } from '../create-variant.command';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductVariant } from '../../entities/product-variant.entity';
import { Product } from '../../entities/product.entity';
import { AttributeValue } from '../../entities/attribute-value.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(CreateVariantCommand)
export class CreateVariantHandler implements ICommandHandler<CreateVariantCommand> {
	constructor(
		@InjectRepository(ProductVariant) private readonly variantRepository: Repository<ProductVariant>,
		@InjectRepository(Product) private readonly productRepository: Repository<Product>,
		@InjectRepository(AttributeValue) private readonly attributeValueRepository: Repository<AttributeValue>,
	) {}

	async execute(command: CreateVariantCommand) {
		const { dto } = command;

		const product = await this.productRepository.findOne({ where: { id: dto.productId } });
		if (!product) {
			throw new RpcException({ statusCode: 404, message: 'Product not found' });
		}

		const existingSku = await this.variantRepository.findOne({ where: { sku: dto.sku } });
		if (existingSku) {
			throw new RpcException({ statusCode: 409, message: 'SKU already exists' });
		}

		const attributeValues = await this.attributeValueRepository.find({
			where: { id: In(dto.attributeValueIds) },
		});
		if (attributeValues.length !== dto.attributeValueIds.length) {
			throw new RpcException({ statusCode: 404, message: 'One or more attribute values not found' });
		}

		const variant = this.variantRepository.create({
			product,
			sku: dto.sku,
			price: dto.price ?? null,
			stock: dto.stock,
			attributeValues,
		});

		return this.variantRepository.save(variant);
	}
}
