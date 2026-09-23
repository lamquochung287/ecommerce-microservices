import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetOrderQuery } from '../get-order.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../entities/order.entity';
import { RpcException } from '@nestjs/microservices';

@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements IQueryHandler<GetOrderQuery> {
	constructor(
		@InjectRepository(Order) private readonly orderRepository: Repository<Order>,
	) {}

	async execute(query: GetOrderQuery) {
		const order = await this.orderRepository.findOne({ where: { id: query.id } });
		if (!order) {
			throw new RpcException({ statusCode: 404, message: 'Order not found' });
		}
		return order;
	}
}
