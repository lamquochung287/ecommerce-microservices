import { IsNumber, IsUUID, Min } from 'class-validator';

export class CartItemDto {
	@IsUUID()
	productId: string;

	@IsNumber()
	@Min(1)
	quantity: number;
}

export interface Cart {
	userId: string;
	items: CartItemDto[];
	updatedAt: string;
}
