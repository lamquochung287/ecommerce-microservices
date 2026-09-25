import { Controller, Post, Body } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentWebhookDto } from '../../../payment/src/dto/charge-payment.dto';

// Không dùng JwtAuthGuard — webhook được gọi bởi payment provider (giả lập hoặc thật), không có JWT của user.
// Xác thực callback dựa vào verify signature (HMAC) trong Payment service, không dựa vào Gateway auth.
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  handleWebhook(@Body() dto: PaymentWebhookDto) {
    return this.paymentService.handleWebhook(dto);
  }
}
