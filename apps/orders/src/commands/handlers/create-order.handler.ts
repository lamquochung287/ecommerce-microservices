import { CommandHandler, ICommandHandler, EventBus } from '@nestjs/cqrs';
import { CreateOrderCommand } from '../create-order.command';
import { OrderCreatedEvent } from '../../events/order-created.event';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
	constructor(
		private readonly eventBus: EventBus,
		@InjectRepository(Order) private readonly orderRepository: Repository<Order>,
	) {}

	async execute(command: CreateOrderCommand) {
		const { dto } = command;

		let totalAmount = 0;
		const orderItems = dto.items.map(itemDto => {
			const itemTotal = itemDto.quantity * itemDto.unitPrice;
			totalAmount += itemTotal;
			
			const item = new OrderItem();
			item.productId = itemDto.productId;
			item.quantity = itemDto.quantity;
			item.unitPrice = itemDto.unitPrice;
			return item;
		});

		const order = this.orderRepository.create({
			userId: dto.userId,
			shippingAddress: dto.shippingAddress,
			status: OrderStatus.PENDING,
			totalAmount,
			items: orderItems,
		});

		const savedOrder = await this.orderRepository.save(order);
		
		this.eventBus.publish(new OrderCreatedEvent(savedOrder.id, savedOrder.userId, savedOrder.totalAmount));
		
		return savedOrder;
	}
}
