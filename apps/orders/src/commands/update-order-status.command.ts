import { UpdateOrderStatusDto } from '../dto/order.dto';

export class UpdateOrderStatusCommand {
	constructor(
		public readonly id: string,
		public readonly dto: UpdateOrderStatusDto,
	) {}
}
