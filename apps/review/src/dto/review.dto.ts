import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateReviewDto {
	@IsUUID()
	userId: string;

	@IsUUID()
	productId: string;

	@IsUUID()
	orderId: string;

	@IsInt()
	@Min(1)
	@Max(5)
	rating: number;

	@IsOptional()
	@IsString()
	@IsNotEmpty()
	comment?: string;
}
