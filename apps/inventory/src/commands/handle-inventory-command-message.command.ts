export class HandleInventoryCommandMessage {
	/** `message` là giá trị Kafka đã parse JSON, chưa được tin cậy (runner kiểm tra envelope). */
	constructor(
		public readonly message: unknown,
		public readonly topic: string,
	) {}
}
