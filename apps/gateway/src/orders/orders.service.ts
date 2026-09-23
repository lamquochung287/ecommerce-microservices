import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { ORDER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { CreateOrderDto, UpdateOrderStatusDto } from '../../../orders/src/dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(@Inject(NAME_SERVICE_TCP.ORDER_SERVICE) private readonly orderClient: ClientProxy) {}

  async createOrder(dto: CreateOrderDto) {
    try {
      return await firstValueFrom(this.orderClient.send({ cmd: ORDER_MESSAGE_PATTERN.CREATE_ORDER }, dto).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'create order', 'Order service');
    }
  }

  async getOrders(userId?: string) {
    try {
      return await firstValueFrom(this.orderClient.send({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDERS }, { userId }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get orders', 'Order service');
    }
  }

  async getOrder(id: string) {
    try {
      return await firstValueFrom(this.orderClient.send({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER }, { id }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get order', 'Order service');
    }
  }

  async updateOrderStatus(id: string, dto: UpdateOrderStatusDto) {
    try {
      return await firstValueFrom(this.orderClient.send({ cmd: ORDER_MESSAGE_PATTERN.UPDATE_ORDER_STATUS }, { id, dto }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'update order status', 'Order service');
    }
  }
}
