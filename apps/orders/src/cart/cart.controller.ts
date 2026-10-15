import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { CART_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CartService } from './cart.service';
import { CartItemDto } from './cart-item.dto';

@Controller()
export class CartController {
	constructor(private readonly cartService: CartService) {}

	@MessagePattern({ cmd: CART_MESSAGE_PATTERN.GET_CART }, Transport.TCP)
	getCart(@Payload() data: { userId: string }) {
		return this.cartService.getCart(data.userId);
	}

	@MessagePattern({ cmd: CART_MESSAGE_PATTERN.ADD_TO_CART }, Transport.TCP)
	addToCart(@Payload() data: { userId: string; item: CartItemDto }) {
		return this.cartService.addItem(data.userId, data.item);
	}

	@MessagePattern({ cmd: CART_MESSAGE_PATTERN.UPDATE_CART_ITEM }, Transport.TCP)
	updateCartItem(@Payload() data: { userId: string; item: CartItemDto }) {
		return this.cartService.updateItem(data.userId, data.item);
	}

	@MessagePattern({ cmd: CART_MESSAGE_PATTERN.REMOVE_FROM_CART }, Transport.TCP)
	removeFromCart(@Payload() data: { userId: string; productId: string }) {
		return this.cartService.removeItem(data.userId, data.productId);
	}

	@MessagePattern({ cmd: CART_MESSAGE_PATTERN.CLEAR_CART }, Transport.TCP)
	async clearCart(@Payload() data: { userId: string }) {
		await this.cartService.clearCart(data.userId);
		return { success: true };
	}
}
