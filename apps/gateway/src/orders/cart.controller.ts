import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Body,
	Param,
	Req,
	UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { GetUser } from '../common/decorator/get-user.decorator';
import { RequireIdempotencyKey } from '../common/decorator/require-idempotency-key.decorator';
import { CartItemDto } from '../../../orders/src/cart/cart-item.dto';
import { CheckoutDto } from '../../../orders/src/dto/checkout.dto';

@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
	constructor(private readonly ordersService: OrdersService) {}

	@Get()
	getCart(@Req() req: Request) {
		return this.ordersService.getCart(req['user'].userId);
	}

	@Post('items')
	addItem(@Req() req: Request, @Body() dto: CartItemDto) {
		return this.ordersService.addToCart(req['user'].userId, dto);
	}

	@Put('items/:productId')
	updateItem(
		@Req() req: Request,
		@Param('productId') productId: string,
		@Body() dto: Omit<CartItemDto, 'productId'>,
	) {
		return this.ordersService.updateCartItem(req['user'].userId, {
			...dto,
			productId,
		});
	}

	@Delete('items/:productId')
	removeItem(@Req() req: Request, @Param('productId') productId: string) {
		return this.ordersService.removeFromCart(req['user'].userId, productId);
	}

	// Gateway chỉ chuyển tiếp: userId từ token, số lượng lấy từ cart và giá lấy từ Product ở Orders.
	// Cart không bị xoá ở đây; Orders chỉ trừ đúng các món đã đặt sau khi thanh toán thành công.
	@Post('checkout')
	@RequireIdempotencyKey()
	checkout(@GetUser('userId') userId: string, @Body() dto: CheckoutDto) {
		return this.ordersService.checkout(userId, dto);
	}
}
