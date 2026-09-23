import { CreateOrderDto } from '../dto/order.dto';

export class CreateOrderCommand {
	constructor(public readonly dto: CreateOrderDto) {}
}
