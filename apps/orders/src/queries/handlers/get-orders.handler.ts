import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetOrdersQuery } from '../get-orders.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../entities/order.entity';

@QueryHandler(GetOrdersQuery)
export class GetOrdersHandler implements IQueryHandler<GetOrdersQuery> {
	constructor(
		@InjectRepository(Order)
		private readonly orderRepository: Repository<Order>,
	) {}

	async execute(query: GetOrdersQuery) {
		const where = query.userId ? { userId: query.userId } : {};
		return await this.orderRepository.find({
			where,
			order: { createdAt: 'DESC' },
		});
	}
}
