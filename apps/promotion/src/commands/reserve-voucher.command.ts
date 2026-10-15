import { ReserveVoucherDto } from '../dto/voucher-redemption.dto';

export class ReserveVoucherCommand {
	constructor(public readonly dto: ReserveVoucherDto) {}
}
