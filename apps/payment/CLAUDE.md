# Hướng dẫn cho AI Agents - Payment Module (AGENTS_GUIDE.md)

## Vai trò
Microservice xử lý thanh toán cho Orders. Theo chiến lược "Simulate trước, Real sau" của roadmap
(xem `plans/260925-1612-production-readiness-roadmap/plan.md`).

## Chức năng chính
- Nhận lệnh charge từ Orders (qua TCP) khi Saga tạo order cần capture payment.
- `PaymentProvider` interface (`charge`, `verifyWebhook`) — implementation mặc định là `SimulatedPaymentProvider`,
  chọn qua env `PAYMENT_PROVIDER=simulate|vnpay|momo`.
- Nhận webhook callback (giả lập hoặc thật), verify signature (HMAC), đảm bảo idempotent (không capture 2 lần
  cho cùng 1 callback).
- Publish event `payment_succeeded`/`payment_failed` qua TCP EventPattern cho Orders/Notification lắng nghe.

## Quy tắc lập trình tại Payment Service
- Không tự ý quyết định gọi provider thật — mặc định luôn là `SimulatedPaymentProvider`.
- Mọi giao dịch (charge) phải được ghi lại vào bảng `payment_transactions` để tra cứu và đảm bảo idempotency
  theo `idempotencyKey`.
- Áp dụng CQRS (`@nestjs/cqrs`) theo chuẩn chung của dự án.
