import { IsNotEmpty, IsObject, IsString, IsUUID } from 'class-validator';

export class OrderIdDto {
	@IsUUID()
	orderId: string;
}

export class HandleShippingWebhookDto {
	/** Giữ nguyên object đã nhận: chữ ký tính trên đúng payload này nên không được whitelist/biến đổi. */
	@IsObject()
	payload: Record<string, unknown>;

	@IsString()
	@IsNotEmpty()
	signature: string;
}
