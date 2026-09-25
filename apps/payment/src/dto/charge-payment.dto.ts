import { IsNotEmpty, IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class ChargePaymentDto {
	@IsUUID()
	orderId: string;

	@IsNumber()
	@IsPositive()
	amount: number;

	@IsString()
	@IsNotEmpty()
	idempotencyKey: string;
}

export class PaymentWebhookDto {
	@IsNotEmpty()
	payload: Record<string, unknown>;

	@IsString()
	@IsNotEmpty()
	signature: string;
}
