import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetRefundsQuery } from '../get-refunds.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Refund } from '../../entities/refund.entity';

@QueryHandler(GetRefundsQuery)
export class GetRefundsHandler implements IQueryHandler<GetRefundsQuery> {
	constructor(
		@InjectRepository(Refund)
		private readonly refundRepository: Repository<Refund>,
	) {}

	async execute(query: GetRefundsQuery) {
		return this.refundRepository.find({
			where: { order: { id: query.orderId } },
			order: { createdAt: 'DESC' },
		});
	}
}
