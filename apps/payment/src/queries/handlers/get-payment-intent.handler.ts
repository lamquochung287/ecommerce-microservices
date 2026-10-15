import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { GetPaymentIntentQuery } from '../get-payment-intent.query';
import { PaymentTransaction } from '../../entities/payment-transaction.entity';

@QueryHandler(GetPaymentIntentQuery)
export class GetPaymentIntentHandler implements IQueryHandler<GetPaymentIntentQuery> {
	constructor(
		@InjectRepository(PaymentTransaction)
		private readonly transactionRepository: Repository<PaymentTransaction>,
	) {}

	async execute(query: GetPaymentIntentQuery) {
		const intent = await this.transactionRepository.findOne({
			where: { id: query.intentId },
		});
		if (!intent) {
			throw new RpcException({
				statusCode: 404,
				message: 'Payment intent not found',
			});
		}
		const expiresAt = intent.expiresAt ? new Date(intent.expiresAt) : null;
		return {
			intentId: intent.id,
			orderId: intent.orderId,
			amount: Number(intent.amount),
			status: intent.status,
			expiresAt: expiresAt ? expiresAt.toISOString() : null,
			expired: expiresAt ? Date.now() >= expiresAt.getTime() : false,
		};
	}
}
