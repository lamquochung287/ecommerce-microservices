/** Message thô từ `shipping-events` (chưa tin cậy); handler tự kiểm tra envelope. */
export class HandleShippingEventCommand {
	constructor(
		readonly message: unknown,
		readonly topic: string,
	) {}
}
