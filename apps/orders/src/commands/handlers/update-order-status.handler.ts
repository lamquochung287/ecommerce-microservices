import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateOrderStatusCommand } from '../update-order-status.command';
import { DataSource } from 'typeorm';
import { Order } from '../../entities/order.entity';
import { Outbox } from '../../entities/outbox.entity';
import { ORDER_EVENT_TYPE } from '../../events/order-event-type.constant';
import { RpcException } from '@nestjs/microservices';
import { canTransition } from '../../order-status.constant';

@CommandHandler(UpdateOrderStatusCommand)
export class UpdateOrderStatusHandler implements ICommandHandler<UpdateOrderStatusCommand> {
	constructor(private readonly dataSource: DataSource) {}

	async execute(command: UpdateOrderStatusCommand) {
		const { id, dto } = command;

		return this.dataSource.transaction(async (manager) => {
			const order = await manager.findOne(Order, { where: { id } });
			if (!order) {
				throw new RpcException({ statusCode: 404, message: 'Order not found' });
			}

			const previousStatus = order.status;
			if (!canTransition(previousStatus, dto.status)) {
				throw new RpcException({
					statusCode: 400,
					message: `Không thể chuyển trạng thái từ ${previousStatus} sang ${dto.status}`,
				});
			}
			order.status = dto.status;
			const savedOrder = await manager.save(order);

			const outboxEvent = manager.create(Outbox, {
				eventType: ORDER_EVENT_TYPE.ORDER_STATUS_UPDATED,
				payload: {
					orderId: savedOrder.id,
					previousStatus,
					status: savedOrder.status,
				},
			});
			await manager.save(outboxEvent);

			return savedOrder;
		});
	}
}
