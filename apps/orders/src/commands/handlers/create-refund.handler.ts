import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateRefundCommand } from '../create-refund.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { Refund, RefundStatus } from '../../entities/refund.entity';
import { RpcException } from '@nestjs/microservices';

const REFUNDABLE_STATUSES = [OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DELIVERED];

@CommandHandler(CreateRefundCommand)
export class CreateRefundHandler implements ICommandHandler<CreateRefundCommand> {
	constructor(
		@InjectRepository(Order) private readonly orderRepository: Repository<Order>,
		@InjectRepository(Refund) private readonly refundRepository: Repository<Refund>,
	) {}

	async execute(command: CreateRefundCommand) {
		const { dto } = command;

		const order = await this.orderRepository.findOne({ where: { id: dto.orderId }, relations: ['refunds'] });
		if (!order) {
			throw new RpcException({ statusCode: 404, message: 'Order not found' });
		}

		if (!REFUNDABLE_STATUSES.includes(order.status)) {
			throw new RpcException({ statusCode: 400, message: `Không thể tạo refund cho order ở trạng thái ${order.status}` });
		}

		const alreadyRefunded = (order.refunds ?? [])
			.filter((r) => r.status !== RefundStatus.REJECTED)
			.reduce((sum, r) => sum + Number(r.amount), 0);

		if (alreadyRefunded + dto.amount > Number(order.totalAmount)) {
			throw new RpcException({ statusCode: 400, message: 'Số tiền refund vượt quá tổng giá trị đơn hàng' });
		}

		const refund = this.refundRepository.create({
			order,
			amount: dto.amount,
			reason: dto.reason,
			status: RefundStatus.PENDING,
		});

		return this.refundRepository.save(refund);
	}
}
