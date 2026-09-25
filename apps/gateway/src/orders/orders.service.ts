import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { ORDER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { CreateOrderDto, UpdateOrderStatusDto } from '../../../orders/src/dto/order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(NAME_SERVICE_TCP.ORDER_SERVICE) private readonly orderClient: ClientProxy,
    private readonly tcpResilience: TcpResilienceService,
  ) {}

  async createOrder(dto: CreateOrderDto) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.ORDER_SERVICE,
        this.orderClient,
        { cmd: ORDER_MESSAGE_PATTERN.CREATE_ORDER },
        dto,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'create order', 'Order service');
    }
  }

  async getOrders(userId?: string) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.ORDER_SERVICE,
        this.orderClient,
        { cmd: ORDER_MESSAGE_PATTERN.GET_ORDERS },
        { userId },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get orders', 'Order service');
    }
  }

  async getOrder(id: string) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.ORDER_SERVICE,
        this.orderClient,
        { cmd: ORDER_MESSAGE_PATTERN.GET_ORDER },
        { id },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get order', 'Order service');
    }
  }

  async updateOrderStatus(id: string, dto: UpdateOrderStatusDto) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.ORDER_SERVICE,
        this.orderClient,
        { cmd: ORDER_MESSAGE_PATTERN.UPDATE_ORDER_STATUS },
        { id, dto },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'update order status', 'Order service');
    }
  }
}
