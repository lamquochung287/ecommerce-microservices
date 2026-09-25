import { ApplyVoucherDto } from '../dto/voucher.dto';

export class ApplyVoucherCommand {
	constructor(public readonly dto: ApplyVoucherDto) {}
}
