export class GetProductsQuery {
	constructor(
		public readonly page: number = 1,
		public readonly limit: number = 20,
		public readonly sortBy: string = 'createdAt',
		public readonly sortOrder: 'ASC' | 'DESC' = 'DESC',
		public readonly categoryId?: string,
		public readonly brandId?: string,
		public readonly minPrice?: number,
		public readonly maxPrice?: number,
		public readonly isActive?: boolean,
		public readonly search?: string,
	) {}
}
