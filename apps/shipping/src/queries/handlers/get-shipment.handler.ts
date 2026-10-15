import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../../entities/shipment.entity';
import { GetShipmentQuery } from '../get-shipment.query';

@QueryHandler(GetShipmentQuery)
export class GetShipmentHandler implements IQueryHandler<GetShipmentQuery> {
	constructor(
		@InjectRepository(Shipment)
		private readonly shipments: Repository<Shipment>,
	) {}

	async execute(query: GetShipmentQuery): Promise<Shipment> {
		const shipment = await this.shipments.findOne({
			where: { orderId: query.orderId },
		});
		if (!shipment) {
			throw new RpcException({
				statusCode: 404,
				message: 'Shipment not found',
			});
		}
		return shipment;
	}
}
