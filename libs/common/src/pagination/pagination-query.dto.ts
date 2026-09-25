import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number = 1;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	limit?: number = 20;

	@IsOptional()
	@IsString()
	sortBy?: string;

	@IsOptional()
	@IsIn(['ASC', 'DESC'])
	sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
