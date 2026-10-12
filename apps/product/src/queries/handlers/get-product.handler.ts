import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetProductQuery } from '../get-product.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { RpcException } from '@nestjs/microservices';

@QueryHandler(GetProductQuery)
export class GetProductHandler implements IQueryHandler<GetProductQuery> {
	constructor(
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
	) {}

	async execute(query: GetProductQuery) {
		const product = await this.productRepository.findOne({
			where: { id: query.id },
			relations: ['category'],
		});
		if (!product) {
			throw new RpcException({ statusCode: 404, message: 'Product not found' });
		}
		return product;
	}
}
