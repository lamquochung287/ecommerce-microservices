import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { evaluateVoucher } from '../../domain/voucher-rules';
import { ValidateVoucherResult } from '../../dto/voucher-redemption.dto';
import { Voucher } from '../../entities/voucher.entity';
import { ValidateVoucherQuery } from '../validate-voucher.query';

/**
 * Chỉ đọc: không khoá, không đổi usageCount. Kết quả có thể lệch nếu lượt hết giữa validate và reserve;
 * reserve kiểm tra lại dưới khoá nên là nguồn sự thật.
 */
@QueryHandler(ValidateVoucherQuery)
export class ValidateVoucherHandler implements IQueryHandler<ValidateVoucherQuery> {
	constructor(
		@InjectRepository(Voucher)
		private readonly vouchers: Repository<Voucher>,
	) {}

	async execute(query: ValidateVoucherQuery): Promise<ValidateVoucherResult> {
		const { code, orderValue } = query.dto;
		const voucher = await this.vouchers.findOne({ where: { code } });
		const discountAmount = evaluateVoucher(voucher, orderValue);
		return { code, discountAmount };
	}
}
