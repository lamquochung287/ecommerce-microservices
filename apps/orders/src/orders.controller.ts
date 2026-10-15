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
import { CheckoutCommand } from './commands/checkout.command';
import { PreparePaymentCommand } from './commands/prepare-payment.command';
import { CheckoutDto } from './dto/checkout.dto';
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

	// userId do Gateway gắn từ token; body chỉ chứa định danh món + địa chỉ.
	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.CHECKOUT })
	async checkout(@Payload() payload: { userId: string; dto: CheckoutDto }) {
		return this.commandBus.execute(
			new CheckoutCommand(payload.userId, payload.dto),
		);
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_PAYMENT_LINK })
	async getPaymentLink(
		@Payload() payload: { orderId: string; userId: string },
	) {
		return this.commandBus.execute(
			new PreparePaymentCommand(payload.orderId, payload.userId),
		);
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
	async updateOrderStatus(
		@Payload() payload: { id: string; dto: UpdateOrderStatusDto },
	) {
		return this.commandBus.execute(
			new UpdateOrderStatusCommand(payload.id, payload.dto),
		);
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
