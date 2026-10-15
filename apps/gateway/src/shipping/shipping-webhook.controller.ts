import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ShippingService } from './shipping.service';
import { HandleShippingWebhookDto } from '../../../shipping/src/dto/shipping.dto';

// Không dùng JwtAuthGuard — carrier gọi webhook, không có JWT của user (vẫn cần x-api-key ở middleware).
// Xác thực callback dựa vào HMAC do Shipping kiểm tra.
@ApiTags('Shipping Webhooks')
@Controller('webhooks/shipping')
export class ShippingWebhookController {
	constructor(private readonly shippingService: ShippingService) {}

	@Post()
	handleWebhook(@Body() dto: HandleShippingWebhookDto) {
		return this.shippingService.handleWebhook(dto);
	}
}
