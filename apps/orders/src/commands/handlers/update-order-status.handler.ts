import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateOrderStatusCommand } from '../update-order-status.command';
import { DataSource } from 'typeorm';
import { Order } from '../../entities/order.entity';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { RpcException } from '@nestjs/microservices';
import { canTransition } from '../../order-status.constant';

@CommandHandler(UpdateOrderStatusCommand)
export class UpdateOrderStatusHandler implements ICommandHandler<UpdateOrderStatusCommand> {
	constructor(
		private readonly dataSource: DataSource,
		private readonly outboxWriter: OutboxWriter,
	) {}

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

			await this.outboxWriter.append(manager, {
				topic: KAFKA_TOPIC.ORDER_EVENTS,
				type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				orderId: savedOrder.id,
				payload: {
					userId: savedOrder.userId,
					previousStatus,
					status: savedOrder.status,
				},
			});

			return savedOrder;
		});
	}
}
