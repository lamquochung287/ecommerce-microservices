import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { ProductService } from '../product/product.service';
import { Cart, CartItemDto } from '../../../orders/src/cart/cart-item.dto';
import { ShippingAddressDto } from '../../../orders/src/dto/order.dto';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly productService: ProductService,
  ) {}

  @Get()
  getCart(@Req() req: Request) {
    return this.ordersService.getCart(req['user'].userId);
  }

  @Post('items')
  addItem(@Req() req: Request, @Body() dto: CartItemDto) {
    return this.ordersService.addToCart(req['user'].userId, dto);
  }

  @Put('items/:productId')
  updateItem(@Req() req: Request, @Param('productId') productId: string, @Body() dto: Omit<CartItemDto, 'productId'>) {
    return this.ordersService.updateCartItem(req['user'].userId, { ...dto, productId });
  }

  @Delete('items/:productId')
  removeItem(@Req() req: Request, @Param('productId') productId: string) {
    return this.ordersService.removeFromCart(req['user'].userId, productId);
  }

  @Post('checkout')
  async checkout(@Req() req: Request, @Body() shippingAddress: ShippingAddressDto) {
    const userId = req['user'].userId;
    const cart = (await this.ordersService.getCart(userId)) as Cart;
    if (!cart.items?.length) {
      throw new BadRequestException('Cart is empty');
    }

    // Snapshot giá hiện tại của từng sản phẩm tại thời điểm checkout (cart chỉ lưu productId/quantity).
    const items = await Promise.all(
      cart.items.map(async (item: CartItemDto) => {
        const product = (await this.productService.getProduct(item.productId)) as { price: number } | undefined;
        if (!product) {
          throw new BadRequestException(`Product ${item.productId} không còn tồn tại`);
        }
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: Number(product.price),
        };
      }),
    );

    const order = await this.ordersService.createOrder({ userId, shippingAddress, items });

    await this.ordersService.clearCart(userId);
    return order;
  }
}
