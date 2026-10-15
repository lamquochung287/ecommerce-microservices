import { CancelOrderDto } from '../dto/order-actions.dto';

/** Payload thô từ TCP; handler kiểm bằng CancelOrderDto. */
export class CancelOrderCommand {
	constructor(public readonly payload: Partial<CancelOrderDto>) {}
}
