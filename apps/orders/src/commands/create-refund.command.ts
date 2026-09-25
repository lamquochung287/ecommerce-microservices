import { CreateRefundDto } from '../dto/refund.dto';

export class CreateRefundCommand {
	constructor(public readonly dto: CreateRefundDto) {}
}
