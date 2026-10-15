import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateOrderStatusCommand } from '../update-order-status.command';
import { DataSource } from 'typeorm';
import { Order } from '../../entities/order.entity';
import { RpcException } from '@nestjs/microservices';
import { OrderTransitionService } from '../../order-state/order-transition.service';

@CommandHandler(UpdateOrderStatusCommand)
export class UpdateOrderStatusHandler implements ICommandHandler<UpdateOrderStatusCommand> {
	constructor(
		private readonly dataSource: DataSource,
		private readonly orderTransition: OrderTransitionService,
	) {}

	async execute(command: UpdateOrderStatusCommand) {
		const { id, dto } = command;

		return this.dataSource.transaction(async (manager) => {
			const order = await manager.findOne(Order, { where: { id } });
			if (!order) {
				throw new RpcException({ statusCode: 404, message: 'Order not found' });
			}

			// canTransition, UPDATE theo version và outbox OrderStatusChanged nằm trong OrderTransitionService.
			return this.orderTransition.transition(manager, {
				order,
				to: dto.status,
			});
		});
	}
}
