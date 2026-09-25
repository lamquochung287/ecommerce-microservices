import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GetTransactionQuery } from '../get-transaction.query';
import { PaymentTransaction } from '../../entities/payment-transaction.entity';

@QueryHandler(GetTransactionQuery)
export class GetTransactionHandler implements IQueryHandler<GetTransactionQuery> {
	constructor(
		@InjectRepository(PaymentTransaction)
		private readonly transactionRepository: Repository<PaymentTransaction>,
	) {}

	async execute(query: GetTransactionQuery) {
		return this.transactionRepository.findOne({
			where: { orderId: query.orderId },
			order: { createdAt: 'DESC' },
		});
	}
}
