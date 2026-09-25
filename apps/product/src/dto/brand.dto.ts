import { IsString, IsOptional } from 'class-validator';

export class CreateBrandDto {
	@IsString()
	name: string;

	@IsString()
	slug: string;

	@IsString()
	@IsOptional()
	description?: string;
}

export class UpdateBrandDto {
	@IsString()
	@IsOptional()
	name?: string;

	@IsString()
	@IsOptional()
	slug?: string;

	@IsString()
	@IsOptional()
	description?: string;
}
