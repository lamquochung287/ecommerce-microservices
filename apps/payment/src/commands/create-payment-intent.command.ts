import { CreatePaymentIntentDto } from '../dto/payment-intent.dto';

export class CreatePaymentIntentCommand {
	constructor(public readonly dto: CreatePaymentIntentDto) {}
}
