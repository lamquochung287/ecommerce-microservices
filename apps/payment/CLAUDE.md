# Hướng dẫn cho AI Agents - Payment Module

## Vai trò
Microservice hybrid: TCP :3004 + Kafka (group `payment-service`). Quản lý **payment intent**, nhận webhook, hoàn tiền cho Orders. Chiến lược "Simulate trước, Real sau". **CQRS**. Outbox qua `MessagingModule.forService({source: PAYMENT})`.
Chi tiết thiết kế: [docs/target-checkout-architecture.md](../../docs/target-checkout-architecture.md) §5.1, §6, §7, §7.1, §10.1.

## Pattern
- TCP (`Transport.TCP` tường minh): `create_payment_intent` · `handle_payment_webhook` · `get_payment_intent` · `simulate_payment` · `get_transaction` · `charge_payment` (Saga cũ, xoá khi cutover).
- Kafka consume `payment-commands`: `CancelPaymentIntent`, `RefundPayment{amount, reason}` (qua `KafkaConsumerRunner`: inbox + transaction + retry/DLQ).
- Kafka produce `payment-events` (qua outbox): `PaymentSucceeded{intentId, amount}`, `PaymentFailed{reason}`, `PaymentRefunded{refundId, amount}`, `PaymentRefundFailed{reason}`.

## Luồng
- **createIntent** `{orderId, amount, idempotencyKey(=orderId), expiresAt}`: theo `idempotencyKey` đã có thì trả intent cũ ở mọi trạng thái (kể cả CANCELLED/SUCCEEDED); mới thì insert `PENDING` (unique violation khi race -> đọc lại), `expiresAt` đúng bằng giá trị Orders gửi (hạn giữ hàng), `checkoutUrl = ${PUBLIC_API_BASE_URL}/simulator/pay/{intentId}`. Mode `PAYMENT_SIM_MODE=auto-*` hẹn giờ `PAYMENT_SIM_DELAY_MS` rồi tự gửi webhook ký HMAC (`PaymentAutoSimulatorService`).
- **Webhook** (1 transaction): verify HMAC-SHA256 trên `JSON.stringify(payload)` bằng `timingSafeEqual` -> sai 400; `INSERT payment_webhook_logs ON CONFLICT (eventId) DO NOTHING` -> trùng `{alreadyProcessed:true}`; khoá intent `FOR UPDATE`; `SUCCEEDED` + intent `PENDING|CANCELLED` -> `SUCCEEDED`+`paidAt`+outbox `PaymentSucceeded` (kể cả intent đã CANCELLED: tiền đã thu, Orders quyết định hoàn); `FAILED` + `PENDING` -> `FAILED`+`PaymentFailed`; còn lại no-op. Payload: `{eventId, intentId, orderId, status, amount, occurredAt}`; orderId/amount phải khớp intent.
- **CancelPaymentIntent**: `UPDATE ... WHERE orderId AND status='PENDING'` -> `CANCELLED` (nguyên tử so với webhook); trạng thái khác no-op.
- **RefundPayment**: bảng `payment_refunds` unique `orderId` (hoàn cả đơn, đúng 1 lần). Đã có bản ghi -> phát lại kết quả đã lưu (không gọi provider; Orders phải idempotent với `PaymentRefunded` trùng). Mới: cần intent `SUCCEEDED`; `amount` > số đã thu hoặc không có giao dịch -> `FAILED` + `PaymentRefundFailed`; gọi `provider.refund` lỗi/ném -> `FAILED`. Hết lượt retry của consumer -> `onExhausted` phát `PaymentRefundFailed` để Orders không kẹt `refundStatus=PENDING`.
- **Simulator**: `SIMULATE_PAYMENT {intentId, result:'success'|'fail'}` trả `{payload, signature}` (Gateway gửi lại vào `/webhooks/payments`); eventId tất định `${intentId}:${result}` nên bấm lặp = webhook trùng. `NODE_ENV=production` -> 404 và auto-simulator tắt. Không chặn khi intent CANCELLED/hết hạn (mô phỏng trả muộn). `GET_INTENT` trả `{intentId, orderId, amount, status, expiresAt, expired}`.

## Quy tắc
- `PAYMENT_WEBHOOK_SECRET` **bắt buộc** (`validateEnv`), không có fallback. Simulator vẫn verify HMAC, không bỏ qua chữ ký.
- Provider qua DI token `PAYMENT_PROVIDER` (`useFactory` + `ConfigService`): `charge`, `createIntent`, `refund`, `signWebhook`, `verifyWebhook`; `buildWebhook` là phần riêng của simulator (`PaymentSimulator`).
- Mọi event ra ngoài ghi `OutboxWriter.append(manager, ...)` cùng transaction với đổi state; không `emit` trực tiếp (trừ `charge_payment` cũ).
- Env tuỳ chọn: `PAYMENT_SIM_MODE` (`manual` mặc định | `auto-success` | `auto-fail`), `PAYMENT_SIM_DELAY_MS` (3000), `PUBLIC_API_BASE_URL` (`http://localhost:3000`), `NODE_ENV`.

## Gotchas
- HMAC trên `JSON.stringify` phụ thuộc thứ tự key; payload do simulator tạo và Gateway chuyển nguyên object. Provider thật phải ký raw body.
- Timer auto-simulator mất khi restart (chỉ cho dev).
- Refund `FAILED` không thử lại được (unique `orderId`): admin xử lý tay.
- `charge_payment` (Saga cũ) vẫn ghi `payment_transactions` với `SUCCEEDED/FAILED` và `emit` TCP `payment_succeeded|payment_failed`; xoá khi cutover.
