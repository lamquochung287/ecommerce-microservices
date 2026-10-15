import {
	IsString,
	IsNumber,
	IsOptional,
	IsBoolean,
	Min,
	IsUUID,
	IsArray,
	IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '@lib/common';

export class CreateProductDto {
	@IsString()
	name: string;

	@IsString()
	slug: string;

	@IsString()
	description: string;

	@IsNumber()
	@Min(0)
	price: number;

	@IsNumber()
	@Min(0)
	@IsOptional()
	lowStockThreshold?: number;

	@IsUUID()
	categoryId: string;

	@IsUUID()
	@IsOptional()
	brandId?: string;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	images?: string[];
}

export class UpdateProductDto {
	@IsString()
	@IsOptional()
	name?: string;

	@IsString()
	@IsOptional()
	slug?: string;

	@IsString()
	@IsOptional()
	description?: string;

	@IsNumber()
	@Min(0)
	@IsOptional()
	price?: number;

	@IsNumber()
	@Min(0)
	@IsOptional()
	lowStockThreshold?: number;

	@IsBoolean()
	@IsOptional()
	isActive?: boolean;

	@IsUUID()
	@IsOptional()
	categoryId?: string;

	@IsUUID()
	@IsOptional()
	brandId?: string;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	images?: string[];
}

export class GetProductsFilterDto extends PaginationQueryDto {
	@IsUUID()
	@IsOptional()
	categoryId?: string;

	@IsUUID()
	@IsOptional()
	brandId?: string;

	@IsNumber()
	@Type(() => Number)
	@Min(0)
	@IsOptional()
	minPrice?: number;

	@IsNumber()
	@Type(() => Number)
	@Min(0)
	@IsOptional()
	maxPrice?: number;

	@IsBoolean()
	@Type(() => Boolean)
	@IsOptional()
	isActive?: boolean;

	@IsString()
	@IsOptional()
	search?: string;

	@IsIn(['name', 'price', 'createdAt'])
	@IsOptional()
	declare sortBy?: string;
}
