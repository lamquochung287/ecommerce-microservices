import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORDER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateOrderCommand } from './commands/create-order.command';
import { UpdateOrderStatusCommand } from './commands/update-order-status.command';
import { GetOrdersQuery } from './queries/get-orders.query';
import { GetOrderQuery } from './queries/get-order.query';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';

@Controller()
export class OrdersController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.CREATE_ORDER })
	async createOrder(@Payload() dto: CreateOrderDto) {
		return this.commandBus.execute(new CreateOrderCommand(dto));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDERS })
	async getOrders(@Payload() data?: { userId?: string }) {
		return this.queryBus.execute(new GetOrdersQuery(data?.userId));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER })
	async getOrder(@Payload() data: { id: string }) {
		return this.queryBus.execute(new GetOrderQuery(data.id));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.UPDATE_ORDER_STATUS })
	async updateOrderStatus(@Payload() payload: { id: string; dto: UpdateOrderStatusDto }) {
		return this.commandBus.execute(new UpdateOrderStatusCommand(payload.id, payload.dto));
	}
}
