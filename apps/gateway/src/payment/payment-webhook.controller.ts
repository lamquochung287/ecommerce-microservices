import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { PaymentWebhookDto } from '../../../payment/src/dto/payment-webhook.dto';

// Không dùng JwtAuthGuard — webhook được gọi bởi payment provider (giả lập hoặc thật), không có JWT của user.
// Xác thực callback dựa vào verify signature (HMAC) trong Payment service, không dựa vào Gateway auth.
@ApiTags('Payment Webhooks')
@Controller('webhooks/payments')
export class PaymentWebhookController {
	constructor(private readonly paymentService: PaymentService) {}

	@Post()
	handleWebhook(@Body() dto: PaymentWebhookDto) {
		return this.paymentService.handleWebhook(dto);
	}
}
