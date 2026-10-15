import { IsString, IsOptional } from 'class-validator';

export class ShippingAddressDto {
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
}
