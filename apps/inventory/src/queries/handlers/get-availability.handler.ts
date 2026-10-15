import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GetAvailabilityQuery } from '../get-availability.query';

export interface AvailabilityItem {
	productId: string;
	available: number;
}

/** Tồn khả dụng cấp sản phẩm (variantId null) = onHand - reserved; sản phẩm chưa có dòng kho = 0. */
@QueryHandler(GetAvailabilityQuery)
export class GetAvailabilityHandler implements IQueryHandler<GetAvailabilityQuery> {
	constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

	async execute(query: GetAvailabilityQuery): Promise<AvailabilityItem[]> {
		const productIds = [...new Set(query.productIds)];
		if (productIds.length === 0) return [];
		const rows: { productId: string; available: number }[] =
			await this.dataSource.manager.query(
				`SELECT "productId", "onHand" - "reserved" AS "available"
				 FROM "stock_items" WHERE "productId" = ANY($1::uuid[]) AND "variantId" IS NULL`,
				[productIds],
			);
		const byProduct = new Map(
			rows.map((r) => [r.productId, Number(r.available)]),
		);
		return productIds.map((productId) => ({
			productId,
			available: byProduct.get(productId) ?? 0,
		}));
	}
}
