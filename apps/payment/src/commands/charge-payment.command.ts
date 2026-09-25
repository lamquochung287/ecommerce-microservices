import { ChargePaymentDto } from '../dto/charge-payment.dto';

export class ChargePaymentCommand {
	constructor(public readonly dto: ChargePaymentDto) {}
}
