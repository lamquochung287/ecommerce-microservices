import { CreateVoucherDto } from '../dto/voucher.dto';

export class CreateVoucherCommand {
	constructor(public readonly dto: CreateVoucherDto) {}
}
