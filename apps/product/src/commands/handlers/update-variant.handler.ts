import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateVariantCommand } from '../update-variant.command';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductVariant } from '../../entities/product-variant.entity';
import { AttributeValue } from '../../entities/attribute-value.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(UpdateVariantCommand)
export class UpdateVariantHandler implements ICommandHandler<UpdateVariantCommand> {
	constructor(
		@InjectRepository(ProductVariant) private readonly variantRepository: Repository<ProductVariant>,
		@InjectRepository(AttributeValue) private readonly attributeValueRepository: Repository<AttributeValue>,
	) {}

	async execute(command: UpdateVariantCommand) {
		const { id, dto } = command;

		const variant = await this.variantRepository.findOne({ where: { id }, relations: ['attributeValues'] });
		if (!variant) {
			throw new RpcException({ statusCode: 404, message: 'Variant not found' });
		}

		if (dto.attributeValueIds) {
			const attributeValues = await this.attributeValueRepository.find({
				where: { id: In(dto.attributeValueIds) },
			});
			if (attributeValues.length !== dto.attributeValueIds.length) {
				throw new RpcException({ statusCode: 404, message: 'One or more attribute values not found' });
			}
			variant.attributeValues = attributeValues;
		}

		if (dto.sku !== undefined) variant.sku = dto.sku;
		if (dto.price !== undefined) variant.price = dto.price;

		return this.variantRepository.save(variant);
	}
}
