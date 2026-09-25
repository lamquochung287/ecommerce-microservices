import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORDER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateOrderCommand } from './commands/create-order.command';
import { UpdateOrderStatusCommand } from './commands/update-order-status.command';
import { CreateRefundCommand } from './commands/create-refund.command';
import { ApproveRefundCommand } from './commands/approve-refund.command';
import { RejectRefundCommand } from './commands/reject-refund.command';
import { GetOrdersQuery } from './queries/get-orders.query';
import { GetOrderQuery } from './queries/get-order.query';
import { GetRefundsQuery } from './queries/get-refunds.query';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/order.dto';
import { CreateRefundDto } from './dto/refund.dto';

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

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.CREATE_REFUND })
	async createRefund(@Payload() dto: CreateRefundDto) {
		return this.commandBus.execute(new CreateRefundCommand(dto));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.APPROVE_REFUND })
	async approveRefund(@Payload() data: { id: string }) {
		return this.commandBus.execute(new ApproveRefundCommand(data.id));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.REJECT_REFUND })
	async rejectRefund(@Payload() data: { id: string }) {
		return this.commandBus.execute(new RejectRefundCommand(data.id));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_REFUNDS })
	async getRefunds(@Payload() data: { orderId: string }) {
		return this.queryBus.execute(new GetRefundsQuery(data.orderId));
	}
}
