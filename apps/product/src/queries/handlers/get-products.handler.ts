import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetProductsQuery } from '../get-products.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';

@QueryHandler(GetProductsQuery)
export class GetProductsHandler implements IQueryHandler<GetProductsQuery> {
	constructor(
		@InjectRepository(Product) private readonly productRepository: Repository<Product>,
	) {}

	async execute(query: GetProductsQuery) {
		return await this.productRepository.find({ relations: ['category'] });
	}
}
