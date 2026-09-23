import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateOrderStatusCommand } from '../update-order-status.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../entities/order.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(UpdateOrderStatusCommand)
export class UpdateOrderStatusHandler implements ICommandHandler<UpdateOrderStatusCommand> {
	constructor(
		@InjectRepository(Order) private readonly orderRepository: Repository<Order>,
	) {}

	async execute(command: UpdateOrderStatusCommand) {
		const { id, dto } = command;

		const order = await this.orderRepository.findOne({ where: { id } });
		if (!order) {
			throw new RpcException({ statusCode: 404, message: 'Order not found' });
		}

		order.status = dto.status;

		return await this.orderRepository.save(order);
	}
}
