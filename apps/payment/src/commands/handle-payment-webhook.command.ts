import { PaymentWebhookDto } from '../dto/payment-webhook.dto';

export class HandlePaymentWebhookCommand {
	constructor(public readonly dto: PaymentWebhookDto) {}
}
