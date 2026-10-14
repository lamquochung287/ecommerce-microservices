# Hướng dẫn cho AI Agents - Payment Module

## Vai trò
Microservice TCP :3004 xử lý thanh toán cho Orders. Chiến lược "Simulate trước, Real sau". **CQRS**.
Chi tiết: [docs/business-flows.md §2.7](../../docs/business-flows.md), [docs/module-processing-flows.md §5](../../docs/module-processing-flows.md).

## Pattern
`charge_payment` · `handle_payment_webhook` · `get_transaction` (giao dịch mới nhất theo `orderId`, `null` nếu chưa có).

## Luồng
- **Charge**: tìm `PaymentTransaction` theo `idempotencyKey` (unique) → có thì trả lại kết quả cũ → `provider.charge` → lưu `SUCCEEDED|FAILED` → `emit payment_succeeded|payment_failed` tới Orders (consumer: `PaymentEventsController` ở Orders) → trả `{success, transactionId, failureReason?}`.
- **Webhook**: `provider.verifyWebhook` (HMAC-SHA256 trên `JSON.stringify(payload)` với `PAYMENT_WEBHOOK_SECRET`) → sai = 400 → `eventId` đã có trong `payment_webhook_logs` (unique) → `{alreadyProcessed:true}`; mới → ghi log. Webhook **chưa** cập nhật Order/Transaction.

## Quy tắc
- Mặc định luôn `SimulatedPaymentProvider` (luôn success). Không tự ý gọi provider thật.
- Mọi charge phải ghi `payment_transactions`; idempotency theo `idempotencyKey` (Orders dùng `orderId`).
- Provider qua DI token `PAYMENT_PROVIDER` (`charge`, `verifyWebhook`). Hiện `PaymentModule` **bind cứng** `useClass: SimulatedPaymentProvider` — muốn chọn theo env phải đổi sang `useFactory`+`ConfigService`.

## Gotchas
- Race: 2 charge cùng key đồng thời cùng qua `findOne` → provider thật bị gọi 2 lần (DB unique chỉ chặn bản ghi thứ 2). Cần lock theo key / gửi key sang provider khi tích hợp thật.
- HMAC trên `JSON.stringify` phụ thuộc thứ tự key; provider thật thường ký trên raw body; so sánh chưa constant-time; secret fallback `simulated-webhook-secret`.
- Trạng thái chỉ `SUCCEEDED|FAILED` (chưa có PENDING/REFUNDED). Gateway `/webhooks/payments` không JWT nhưng vẫn cần `x-api-key`.
