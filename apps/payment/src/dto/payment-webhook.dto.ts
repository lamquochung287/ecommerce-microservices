import { IsNotEmpty, IsString } from 'class-validator';

export class PaymentWebhookDto {
	@IsNotEmpty()
	payload: Record<string, unknown>;

	@IsString()
	@IsNotEmpty()
	signature: string;
}
