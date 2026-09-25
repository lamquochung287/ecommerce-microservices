import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class CreateAddressDto {
	@IsUUID()
	userId: string;

	@IsString()
	recipientName: string;

	@IsString()
	recipientPhone: string;

	@IsString()
	addressLine1: string;

	@IsString()
	@IsOptional()
	addressLine2?: string;

	@IsString()
	city: string;

	@IsString()
	@IsOptional()
	province?: string;

	@IsString()
	@IsOptional()
	postalCode?: string;

	@IsString()
	country: string;

	@IsBoolean()
	@IsOptional()
	isDefault?: boolean;
}

export class UpdateAddressDto {
	@IsString()
	@IsOptional()
	recipientName?: string;

	@IsString()
	@IsOptional()
	recipientPhone?: string;

	@IsString()
	@IsOptional()
	addressLine1?: string;

	@IsString()
	@IsOptional()
	addressLine2?: string;

	@IsString()
	@IsOptional()
	city?: string;

	@IsString()
	@IsOptional()
	province?: string;

	@IsString()
	@IsOptional()
	postalCode?: string;

	@IsString()
	@IsOptional()
	country?: string;
}
