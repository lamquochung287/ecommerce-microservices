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
		const { page, limit } = query;
		const skip = (page - 1) * limit;

		const [data, total] = await this.productRepository.findAndCount({
			relations: ['category'],
			skip,
			take: limit,
			order: { createdAt: 'DESC' }, // Thêm order để phân trang chuẩn
		});

		return {
			data,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			}
		};
	}
}
