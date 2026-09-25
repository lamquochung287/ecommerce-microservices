import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetProductsQuery } from '../get-products.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { buildPaginationMeta } from '@lib/common';

const SORTABLE_FIELDS = new Set(['name', 'price', 'stock', 'createdAt']);

@QueryHandler(GetProductsQuery)
export class GetProductsHandler implements IQueryHandler<GetProductsQuery> {
	constructor(
		@InjectRepository(Product) private readonly productRepository: Repository<Product>,
	) {}

	async execute(query: GetProductsQuery) {
		const { page, limit, sortBy, sortOrder, categoryId, brandId, minPrice, maxPrice, isActive, search } = query;
		const skip = (page - 1) * limit;

		const qb = this.productRepository
			.createQueryBuilder('product')
			.leftJoinAndSelect('product.category', 'category')
			.leftJoinAndSelect('product.brand', 'brand');

		if (categoryId) qb.andWhere('category.id = :categoryId', { categoryId });
		if (brandId) qb.andWhere('brand.id = :brandId', { brandId });
		if (minPrice !== undefined) qb.andWhere('product.price >= :minPrice', { minPrice });
		if (maxPrice !== undefined) qb.andWhere('product.price <= :maxPrice', { maxPrice });
		if (isActive !== undefined) qb.andWhere('product.isActive = :isActive', { isActive });
		if (search) qb.andWhere('product.name ILIKE :search', { search: `%${search}%` });

		const sortField = SORTABLE_FIELDS.has(sortBy) ? sortBy : 'createdAt';
		qb.orderBy(`product.${sortField}`, sortOrder).skip(skip).take(limit);

		const [data, total] = await qb.getManyAndCount();

		return {
			data,
			meta: buildPaginationMeta(total, page, limit),
		};
	}
}
