import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { ORDER_MESSAGE_PATTERN, CART_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { CreateOrderDto, UpdateOrderStatusDto } from '../../../orders/src/dto/order.dto';
import { CreateRefundDto } from '../../../orders/src/dto/refund.dto';
import { CartItemDto } from '../../../orders/src/cart/cart-item.dto';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(NAME_SERVICE_TCP.ORDER_SERVICE) private readonly orderClient: ClientProxy,
    private readonly tcpResilience: TcpResilienceService,
  ) {}

  private async send(cmd: string, payload: unknown, action: string) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.ORDER_SERVICE,
        this.orderClient,
        { cmd },
        payload,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, action, 'Order service');
    }
  }

  createOrder(dto: CreateOrderDto) {
    return this.send(ORDER_MESSAGE_PATTERN.CREATE_ORDER, dto, 'create order');
  }

  getOrders(userId?: string) {
    return this.send(ORDER_MESSAGE_PATTERN.GET_ORDERS, { userId }, 'get orders');
  }

  getOrder(id: string) {
    return this.send(ORDER_MESSAGE_PATTERN.GET_ORDER, { id }, 'get order');
  }

  updateOrderStatus(id: string, dto: UpdateOrderStatusDto) {
    return this.send(ORDER_MESSAGE_PATTERN.UPDATE_ORDER_STATUS, { id, dto }, 'update order status');
  }

  createRefund(dto: CreateRefundDto) {
    return this.send(ORDER_MESSAGE_PATTERN.CREATE_REFUND, dto, 'create refund');
  }

  approveRefund(id: string) {
    return this.send(ORDER_MESSAGE_PATTERN.APPROVE_REFUND, { id }, 'approve refund');
  }

  rejectRefund(id: string) {
    return this.send(ORDER_MESSAGE_PATTERN.REJECT_REFUND, { id }, 'reject refund');
  }

  getRefunds(orderId: string) {
    return this.send(ORDER_MESSAGE_PATTERN.GET_REFUNDS, { orderId }, 'get refunds');
  }

  getCart(userId: string) {
    return this.send(CART_MESSAGE_PATTERN.GET_CART, { userId }, 'get cart');
  }

  addToCart(userId: string, item: CartItemDto) {
    return this.send(CART_MESSAGE_PATTERN.ADD_TO_CART, { userId, item }, 'add to cart');
  }

  updateCartItem(userId: string, item: CartItemDto) {
    return this.send(CART_MESSAGE_PATTERN.UPDATE_CART_ITEM, { userId, item }, 'update cart item');
  }

  removeFromCart(userId: string, productId: string) {
    return this.send(CART_MESSAGE_PATTERN.REMOVE_FROM_CART, { userId, productId }, 'remove from cart');
  }

  clearCart(userId: string) {
    return this.send(CART_MESSAGE_PATTERN.CLEAR_CART, { userId }, 'clear cart');
  }
}
