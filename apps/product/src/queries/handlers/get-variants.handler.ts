import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetVariantsQuery } from '../get-variants.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductVariant } from '../../entities/product-variant.entity';

@QueryHandler(GetVariantsQuery)
export class GetVariantsHandler implements IQueryHandler<GetVariantsQuery> {
	constructor(
		@InjectRepository(ProductVariant) private readonly variantRepository: Repository<ProductVariant>,
	) {}

	async execute(query: GetVariantsQuery) {
		return this.variantRepository.find({
			where: { product: { id: query.productId } },
			relations: ['attributeValues', 'attributeValues.attribute'],
			order: { createdAt: 'ASC' },
		});
	}
}
