import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayNotEmpty,
	IsArray,
	IsDefined,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	ValidateNested,
} from 'class-validator';
import { ShippingAddressDto } from './order.dto';

export const MAX_CHECKOUT_ITEMS = 50;

/** Chỉ định danh món được chọn; số lượng lấy từ cart, giá lấy từ Product. */
export class CheckoutItemDto {
	@IsUUID()
	productId: string;

	@IsOptional()
	@IsUUID()
	variantId?: string;
}

export class CheckoutDto {
	@IsArray()
	@ArrayNotEmpty()
	@ArrayMaxSize(MAX_CHECKOUT_ITEMS)
	@ValidateNested({ each: true })
	@Type(() => CheckoutItemDto)
	items: CheckoutItemDto[];

	@IsDefined()
	@ValidateNested()
	@Type(() => ShippingAddressDto)
	shippingAddress: ShippingAddressDto;

	@IsOptional()
	@IsString()
	@MaxLength(50)
	voucherCode?: string;
}
