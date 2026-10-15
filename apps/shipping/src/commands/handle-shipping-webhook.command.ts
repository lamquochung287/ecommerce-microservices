import { HandleShippingWebhookDto } from '../dto/shipping.dto';

export class HandleShippingWebhookCommand {
	constructor(public readonly dto: HandleShippingWebhookDto) {}
}
