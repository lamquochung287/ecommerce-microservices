import { IsString, IsOptional, IsArray, ArrayMinSize } from 'class-validator';

export class CreateAttributeDto {
	@IsString()
	name: string;

	@IsArray()
	@ArrayMinSize(1)
	@IsString({ each: true })
	values: string[];
}

export class UpdateAttributeDto {
	@IsString()
	@IsOptional()
	name?: string;
}

export class AddAttributeValueDto {
	@IsString()
	value: string;
}
