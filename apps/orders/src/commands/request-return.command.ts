import { RequestReturnDto } from '../dto/order-actions.dto';

/** Payload thô từ TCP; handler kiểm bằng RequestReturnDto. */
export class RequestReturnCommand {
	constructor(public readonly payload: Partial<RequestReturnDto>) {}
}
