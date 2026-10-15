/** Message thô từ `inventory-events` (chưa tin cậy); handler tự kiểm tra envelope. */
export class HandleInventoryEventCommand {
	constructor(
		readonly message: unknown,
		readonly topic: string,
	) {}
}
