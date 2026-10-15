import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload, Transport } from '@nestjs/microservices';
import { ORDER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { GetOrdersQuery } from './queries/get-orders.query';
import { GetOrderQuery } from './queries/get-order.query';
import { GetRefundsQuery } from './queries/get-refunds.query';
import { CheckoutCommand } from './commands/checkout.command';
import { PreparePaymentCommand } from './commands/prepare-payment.command';
import { CancelOrderCommand } from './commands/cancel-order.command';
import { RequestReturnCommand } from './commands/request-return.command';
import { CheckoutDto } from './dto/checkout.dto';
import { CancelOrderDto, RequestReturnDto } from './dto/order-actions.dto';

@Controller()
export class OrdersController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	// userId do Gateway gắn từ token; body chỉ chứa định danh món + địa chỉ.
	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.CHECKOUT }, Transport.TCP)
	async checkout(@Payload() payload: { userId: string; dto: CheckoutDto }) {
		return this.commandBus.execute(
			new CheckoutCommand(payload.userId, payload.dto),
		);
	}

	@MessagePattern(
		{ cmd: ORDER_MESSAGE_PATTERN.GET_PAYMENT_LINK },
		Transport.TCP,
	)
	async getPaymentLink(
		@Payload() payload: { orderId: string; userId: string },
	) {
		return this.commandBus.execute(
			new PreparePaymentCommand(payload.orderId, payload.userId),
		);
	}

	// userId do Gateway gắn từ token; Orders tự kiểm tra chủ sở hữu.
	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.CANCEL_ORDER }, Transport.TCP)
	async cancelOrder(@Payload() payload: CancelOrderDto) {
		return this.commandBus.execute(new CancelOrderCommand(payload));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.REQUEST_RETURN }, Transport.TCP)
	async requestReturn(@Payload() payload: RequestReturnDto) {
		return this.commandBus.execute(new RequestReturnCommand(payload));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDERS }, Transport.TCP)
	async getOrders(@Payload() data?: { userId?: string }) {
		return this.queryBus.execute(new GetOrdersQuery(data?.userId));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER }, Transport.TCP)
	async getOrder(@Payload() data: { id: string }) {
		return this.queryBus.execute(new GetOrderQuery(data.id));
	}

	@MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_REFUNDS }, Transport.TCP)
	async getRefunds(@Payload() data: { orderId: string }) {
		return this.queryBus.execute(new GetRefundsQuery(data.orderId));
	}
}
