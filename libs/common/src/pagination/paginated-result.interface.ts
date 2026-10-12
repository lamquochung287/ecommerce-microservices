export interface PaginationMeta {
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface PaginatedResult<T> {
	data: T[];
	meta: PaginationMeta;
}

export function buildPaginationMeta(
	total: number,
	page: number,
	limit: number,
): PaginationMeta {
	return {
		total,
		page,
		limit,
		totalPages: Math.ceil(total / limit),
	};
}
