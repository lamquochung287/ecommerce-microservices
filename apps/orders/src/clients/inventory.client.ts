import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { INVENTORY_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import {
	INVENTORY_CLIENT,
	SERVICE_CALL_TIMEOUT_MS,
} from './client-tokens.constant';
import { sendTcp } from './rpc-error.util';

export interface ReserveInventoryRequest {
	orderId: string;
	items: { productId: string; quantity: number }[];
	ttlSeconds: number;
	/** Đơn chờ thanh toán cũ bị đơn mới thay thế; Inventory trả phần giữ của chúng trong cùng transaction. */
	replaces: string[];
}

export interface ReserveInventoryResult {
	orderId: string;
	status: string;
	/** ISO string (Date đi qua TCP bị JSON hoá). */
	expiresAt: string;
}

export interface ReservationCheckResult {
	valid: boolean;
	status: string;
	expiresAt: string | null;
}

@Injectable()
export class InventoryClient {
	constructor(@Inject(INVENTORY_CLIENT) private readonly client: ClientProxy) {}

	reserve(request: ReserveInventoryRequest): Promise<ReserveInventoryResult> {
		return sendTcp(
			this.client,
			INVENTORY_MESSAGE_PATTERN.RESERVE,
			request,
			SERVICE_CALL_TIMEOUT_MS,
		);
	}

	checkReservation(orderId: string): Promise<ReservationCheckResult> {
		return sendTcp(
			this.client,
			INVENTORY_MESSAGE_PATTERN.CHECK_RESERVATION,
			{ orderId },
			SERVICE_CALL_TIMEOUT_MS,
		);
	}

	release(orderId: string): Promise<{ released: boolean }> {
		return sendTcp(
			this.client,
			INVENTORY_MESSAGE_PATTERN.RELEASE,
			{ orderId },
			SERVICE_CALL_TIMEOUT_MS,
		);
	}
}
