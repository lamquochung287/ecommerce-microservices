import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetProductsQuery } from '../get-products.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { buildPaginationMeta } from '@lib/common';
import { CachedService } from '@lib/cached';
import { createHash } from 'crypto';

// Danh sách chỉ cần các cột của thẻ sản phẩm; description và cột nội bộ chỉ có ở GET /products/:id.
const LIST_COLUMNS = [
	'product.id',
	'product.name',
	'product.slug',
	'product.price',
	'product.images',
	'product.isActive',
	'product.createdAt',
	'category.id',
	'category.name',
	'category.slug',
	'brand.id',
	'brand.name',
	'brand.slug',
];

const SORTABLE_FIELDS = new Set(['name', 'price', 'createdAt']);

// total chỉ phụ thuộc bộ lọc (không phụ thuộc page/limit/sort) nên mọi trang của cùng bộ lọc dùng chung một key.
// Tăng version khi đổi cách đếm để bỏ qua key cũ.
const TOTAL_CACHE_PREFIX = 'products:total:v1:';
const TOTAL_CACHE_TTL_SECONDS = 60;
const TOTAL_CACHE_TIMEOUT_MS = 100;
const SEARCH_KEY_MAX_LENGTH = 100;

@QueryHandler(GetProductsQuery)
export class GetProductsHandler implements IQueryHandler<GetProductsQuery> {
	constructor(
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
		private readonly cachedService: CachedService,
	) {}

	async execute(query: GetProductsQuery) {
		const {
			page,
			limit,
			sortBy,
			sortOrder,
			categoryId,
			brandId,
			minPrice,
			maxPrice,
			isActive,
			search,
		} = query;
		const skip = (page - 1) * limit;

		const qb = this.productRepository
			.createQueryBuilder('product')
			.leftJoin('product.category', 'category')
			.leftJoin('product.brand', 'brand')
			.select(LIST_COLUMNS);

		if (categoryId) qb.andWhere('category.id = :categoryId', { categoryId });
		if (brandId) qb.andWhere('brand.id = :brandId', { brandId });
		if (minPrice !== undefined)
			qb.andWhere('product.price >= :minPrice', { minPrice });
		if (maxPrice !== undefined)
			qb.andWhere('product.price <= :maxPrice', { maxPrice });
		if (isActive !== undefined)
			qb.andWhere('product.isActive = :isActive', { isActive });
		if (search)
			qb.andWhere('product.name ILIKE :search', { search: `%${search}%` });

		const sortField = SORTABLE_FIELDS.has(sortBy) ? sortBy : 'createdAt';
		qb.orderBy(`product.${sortField}`, sortOrder).skip(skip).take(limit);

		const total = await this.getTotal(query, qb);
		const data = await qb.getMany();

		return {
			data,
			meta: buildPaginationMeta(total, page, limit),
		};
	}

	/** Đếm tổng theo bộ lọc, ưu tiên cache Redis; Redis chậm/lỗi thì đếm thẳng DB. */
	private async getTotal(
		query: GetProductsQuery,
		qb: SelectQueryBuilder<Product>,
	): Promise<number> {
		const key = this.buildTotalCacheKey(query);
		const cached = await this.withTimeout(this.cachedService.get(key));
		if (cached !== null) {
			const parsed = Number(cached);
			if (Number.isInteger(parsed) && parsed >= 0) return parsed;
		}

		const total = await qb.getCount();
		await this.withTimeout(
			this.cachedService.set(key, String(total), TOTAL_CACHE_TTL_SECONDS),
		);
		return total;
	}

	private buildTotalCacheKey(query: GetProductsQuery): string {
		const search = (query.search ?? '').trim().toLowerCase();
		const searchPart =
			search.length > SEARCH_KEY_MAX_LENGTH
				? createHash('sha256').update(search).digest('hex')
				: search;
		const parts = [
			query.categoryId ?? '',
			query.brandId ?? '',
			query.minPrice ?? '',
			query.maxPrice ?? '',
			query.isActive ?? '',
			searchPart,
		];
		return TOTAL_CACHE_PREFIX + parts.join('|');
	}

	/** Cache chỉ là lớp tăng tốc: lỗi hoặc quá hạn coi như miss, không làm hỏng request. */
	private async withTimeout<T>(task: Promise<T>): Promise<T | null> {
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				task,
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), TOTAL_CACHE_TIMEOUT_MS);
				}),
			]);
		} catch {
			return null;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
