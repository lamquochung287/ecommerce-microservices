import { SimulatePaymentDto } from '../dto/payment-intent.dto';

export class SimulatePaymentCommand {
	constructor(public readonly dto: SimulatePaymentDto) {}
}
