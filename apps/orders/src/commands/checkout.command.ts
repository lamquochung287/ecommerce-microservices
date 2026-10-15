import { CheckoutDto } from '../dto/checkout.dto';

export class CheckoutCommand {
	constructor(
		/** Lấy từ token do Gateway gắn, không từ body. */
		public readonly userId: string,
		public readonly dto: CheckoutDto,
	) {}
}
