/** Message thô từ `payment-events` (chưa tin cậy); handler tự kiểm tra envelope. */
export class HandlePaymentEventCommand {
	constructor(
		readonly message: unknown,
		readonly topic: string,
	) {}
}
