export class ProductCreatedEvent {
	constructor(
		public readonly productId: string,
		public readonly name: string,
		public readonly price: number,
	) {}
}
