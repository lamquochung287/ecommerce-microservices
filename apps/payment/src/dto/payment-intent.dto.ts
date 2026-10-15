import {
	IsDateString,
	IsIn,
	IsNotEmpty,
	IsNumber,
	IsPositive,
	IsString,
	IsUUID,
} from 'class-validator';

export class CreatePaymentIntentDto {
	@IsUUID()
	orderId: string;

	@IsNumber({ maxDecimalPlaces: 2 })
	@IsPositive()
	amount: number;

	@IsString()
	@IsNotEmpty()
	idempotencyKey: string;

	// Hạn giữ hàng của Orders; intent không được sống lâu hơn mốc này.
	@IsDateString()
	expiresAt: string;
}

export class IntentIdDto {
	@IsUUID()
	intentId: string;
}

export class SimulatePaymentDto {
	@IsUUID()
	intentId: string;

	@IsIn(['success', 'fail'])
	result: 'success' | 'fail';
}
