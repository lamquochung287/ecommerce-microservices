import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { GetAvailableVouchersQuery } from '../get-available-vouchers.query';
import { Voucher } from '../../entities/voucher.entity';

@QueryHandler(GetAvailableVouchersQuery)
export class GetAvailableVouchersHandler implements IQueryHandler<GetAvailableVouchersQuery> {
	constructor(
		@InjectRepository(Voucher)
		private readonly voucherRepository: Repository<Voucher>,
	) {}

	async execute() {
		const vouchers = await this.voucherRepository.find({
			where: { expiresAt: MoreThan(new Date()) },
			order: { createdAt: 'DESC' },
		});
		return vouchers.filter(
			(voucher) => voucher.usageCount < voucher.usageLimit,
		);
	}
}
