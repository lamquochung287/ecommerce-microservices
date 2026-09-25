import { IsDateString, IsEnum, IsInt, IsNumber, IsPositive, IsString, IsNotEmpty, Min } from 'class-validator';
import { DiscountType } from '../entities/voucher.entity';

export class CreateVoucherDto {
	@IsString()
	@IsNotEmpty()
	code: string;

	@IsEnum(DiscountType)
	discountType: DiscountType;

	@IsNumber()
	@IsPositive()
	discountValue: number;

	@IsNumber()
	@Min(0)
	minOrderValue: number;

	@IsDateString()
	expiresAt: string;

	@IsInt()
	@IsPositive()
	usageLimit: number;
}

export class ApplyVoucherDto {
	@IsString()
	@IsNotEmpty()
	code: string;

	@IsNumber()
	@IsPositive()
	orderValue: number;
}
