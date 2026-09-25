import { PaymentWebhookDto } from '../dto/charge-payment.dto';

export class HandlePaymentWebhookCommand {
	constructor(public readonly dto: PaymentWebhookDto) {}
}
