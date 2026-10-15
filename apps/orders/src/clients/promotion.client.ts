import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PROMOTION_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import {
	PROMOTION_CLIENT,
	SERVICE_CALL_TIMEOUT_MS,
} from './client-tokens.constant';
import { sendTcp } from './rpc-error.util';

export interface VoucherDiscount {
	code: string;
	/** Đã làm tròn 2 số; tính trên subtotal (trước thuế/ship). */
	discountAmount: number;
}

export interface ReserveVoucherRequest {
	code: string;
	orderId: string;
	userId: string;
	/** subtotal của đơn. */
	orderValue: number;
}

@Injectable()
export class PromotionClient {
	constructor(@Inject(PROMOTION_CLIENT) private readonly client: ClientProxy) {}

	/** Chỉ đọc, không giữ lượt. Promotion ném 404 (không có voucher) hoặc 400 (hết hạn/hết lượt/chưa đủ giá trị tối thiểu). */
	validate(code: string, orderValue: number): Promise<VoucherDiscount> {
		return sendTcp(
			this.client,
			PROMOTION_MESSAGE_PATTERN.VALIDATE_VOUCHER,
			{ code, orderValue },
			SERVICE_CALL_TIMEOUT_MS,
		);
	}

	/** Giữ một lượt cho đơn; idempotent theo orderId. */
	reserve(request: ReserveVoucherRequest): Promise<VoucherDiscount> {
		return sendTcp(
			this.client,
			PROMOTION_MESSAGE_PATTERN.RESERVE_VOUCHER,
			request,
			SERVICE_CALL_TIMEOUT_MS,
		);
	}

	/** Trả lượt đang giữ của đơn; no-op nếu không ở trạng thái RESERVED. */
	release(orderId: string): Promise<{ released: boolean }> {
		return sendTcp(
			this.client,
			PROMOTION_MESSAGE_PATTERN.RELEASE_VOUCHER,
			{ orderId },
			SERVICE_CALL_TIMEOUT_MS,
		);
	}
}
