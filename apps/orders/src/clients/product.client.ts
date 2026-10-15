import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import {
	PRODUCT_CLIENT,
	SERVICE_CALL_TIMEOUT_MS,
} from './client-tokens.constant';
import { sendTcp } from './rpc-error.util';

export interface ProductSnapshot {
	id: string;
	/** decimal của Postgres về dạng string. */
	price: number | string;
	isActive: boolean;
}

@Injectable()
export class ProductClient {
	constructor(@Inject(PRODUCT_CLIENT) private readonly client: ClientProxy) {}

	/** Product ném 404 nếu không tồn tại. */
	getProduct(id: string): Promise<ProductSnapshot> {
		return sendTcp(
			this.client,
			PRODUCT_MESSAGE_PATTERN.GET_PRODUCT,
			{ id },
			SERVICE_CALL_TIMEOUT_MS,
		);
	}
}
