import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateOrderCommand } from '../create-order.command';
import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { Outbox } from '../../entities/outbox.entity';
import { ORDER_EVENT_TYPE } from '../../events/order-event-type.constant';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
	constructor(private readonly dataSource: DataSource) {}

	async execute(command: CreateOrderCommand) {
		const { dto } = command;

		let totalAmount = 0;
		const orderItems = dto.items.map((itemDto) => {
			const itemTotal = itemDto.quantity * itemDto.unitPrice;
			totalAmount += itemTotal;

			const item = new OrderItem();
			item.productId = itemDto.productId;
			item.quantity = itemDto.quantity;
			item.unitPrice = itemDto.unitPrice;
			return item;
		});

		return this.dataSource.transaction(async (manager) => {
			const order = manager.create(Order, {
				userId: dto.userId,
				shippingAddress: dto.shippingAddress,
				status: OrderStatus.PENDING,
				totalAmount,
				items: orderItems,
			});
			const savedOrder = await manager.save(order);

			const outboxEvent = manager.create(Outbox, {
				eventType: ORDER_EVENT_TYPE.ORDER_CREATED,
				payload: {
					orderId: savedOrder.id,
					userId: savedOrder.userId,
					totalAmount: savedOrder.totalAmount,
				},
			});
			await manager.save(outboxEvent);

			return savedOrder;
		});
	}
}
