import { EntityManager } from 'typeorm';

export class ReleaseVoucherCommand {
	/**
	 * `manager` có khi gọi từ consumer Kafka (chạy chung transaction với inbox); không có khi gọi qua TCP
	 * (handler tự mở transaction).
	 */
	constructor(
		public readonly orderId: string,
		public readonly manager?: EntityManager,
	) {}
}
