import { IsString, IsNumber, IsOptional, IsUUID, Min, IsArray, ArrayMinSize } from 'class-validator';

export class CreateVariantDto {
	@IsUUID()
	productId: string;

	@IsString()
	sku: string;

	@IsNumber()
	@Min(0)
	@IsOptional()
	price?: number;

	@IsNumber()
	@Min(0)
	stock: number;

	@IsArray()
	@ArrayMinSize(1)
	@IsUUID(undefined, { each: true })
	attributeValueIds: string[];
}

export class UpdateVariantDto {
	@IsString()
	@IsOptional()
	sku?: string;

	@IsNumber()
	@Min(0)
	@IsOptional()
	price?: number;

	@IsArray()
	@IsUUID(undefined, { each: true })
	@IsOptional()
	attributeValueIds?: string[];
}

export class AdjustStockDto {
	@IsUUID()
	@IsOptional()
	productId?: string;

	@IsUUID()
	@IsOptional()
	variantId?: string;

	@IsNumber()
	delta: number;

	@IsString()
	@IsOptional()
	reason?: string;
}
