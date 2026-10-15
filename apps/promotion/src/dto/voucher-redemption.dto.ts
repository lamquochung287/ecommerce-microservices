import {
	IsNotEmpty,
	IsNumber,
	IsPositive,
	IsString,
	IsUUID,
} from 'class-validator';

export class ValidateVoucherDto {
	@IsString()
	@IsNotEmpty()
	code: string;

	@IsNumber()
	@IsPositive()
	orderValue: number;
}

export class ReserveVoucherDto {
	@IsString()
	@IsNotEmpty()
	code: string;

	@IsUUID()
	orderId: string;

	@IsUUID()
	userId: string;

	@IsNumber()
	@IsPositive()
	orderValue: number;
}

export class ReleaseVoucherDto {
	@IsUUID()
	orderId: string;
}

export interface ValidateVoucherResult {
	code: string;
	discountAmount: number;
}

export interface ReleaseVoucherResult {
	released: boolean;
}
