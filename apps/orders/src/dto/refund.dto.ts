import { IsNumber, IsString, IsUUID, Min } from 'class-validator';

export class CreateRefundDto {
	@IsUUID()
	orderId: string;

	@IsNumber()
	@Min(0.01)
	amount: number;

	@IsString()
	reason: string;
}
