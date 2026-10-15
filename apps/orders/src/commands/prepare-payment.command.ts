export class PreparePaymentCommand {
	constructor(
		public readonly orderId: string,
		public readonly userId: string,
	) {}
}
