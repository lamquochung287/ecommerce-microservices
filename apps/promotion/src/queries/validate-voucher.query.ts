import { ValidateVoucherDto } from '../dto/voucher-redemption.dto';

export class ValidateVoucherQuery {
	constructor(public readonly dto: ValidateVoucherDto) {}
}
