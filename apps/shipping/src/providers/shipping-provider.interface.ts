import type { ShipmentItem, ShipmentRecipient } from '@lib/messaging';

export const SHIPPING_PROVIDER = 'SHIPPING_PROVIDER';

export interface CreateShipmentInput {
	orderId: string;
	recipient: ShipmentRecipient;
	items: ShipmentItem[];
}

export interface CreatedShipment {
	trackingCode: string;
	carrier: string;
}

/** Cổng tới hãng vận chuyển; thay bản mô phỏng bằng carrier thật chỉ cần cung cấp lại token này. */
export interface ShippingProvider {
	/** Ném lỗi khi carrier từ chối/không phản hồi; runner sẽ retry rồi đưa vào DLQ. */
	createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
	cancelShipment(trackingCode: string): Promise<void>;
	signWebhook(payload: Record<string, unknown>): string;
	verifyWebhook(payload: Record<string, unknown>, signature: string): boolean;
}
