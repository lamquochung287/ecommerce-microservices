import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GetVouchersQuery } from '../get-vouchers.query';
import { Voucher } from '../../entities/voucher.entity';

@QueryHandler(GetVouchersQuery)
export class GetVouchersHandler implements IQueryHandler<GetVouchersQuery> {
	constructor(
		@InjectRepository(Voucher) private readonly voucherRepository: Repository<Voucher>,
	) {}

	async execute() {
		return this.voucherRepository.find({ order: { createdAt: 'DESC' } });
	}
}
