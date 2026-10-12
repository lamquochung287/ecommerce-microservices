# Hướng dẫn cho AI Agents - Notification Module

## Vai trò
Microservice TCP :3005 gửi thông báo khi có sự kiện từ Orders. Chiến lược "Simulate trước, Real sau". **Không dùng CQRS** (controller + provider trực tiếp).
Chi tiết: [docs/business-flows.md §2.10](../../docs/business-flows.md), [docs/module-processing-flows.md §6](../../docs/module-processing-flows.md).

## Luồng
`OrderEventsController` `@EventPattern('order.created' | 'order.status_updated')` (Orders `OutboxWorker` emit trực tiếp tới TCP client của Notification — TCP là point-to-point, không broadcast) →
1. `User.GET_USER_INFO(userId)` lấy email (lỗi → fallback dùng `userId` làm recipient, log warn);
2. `EmailProvider.send` (Simulated: chỉ log);
3. ghi `sent_notifications {channel, recipient, subject, body, status SENT|FAILED, sourceEvent}`.
`get_sent_notifications {recipient?}` trả lịch sử (chưa có route ở Gateway).

## Quy tắc
- Provider qua DI token `EMAIL_PROVIDER`/`PUSH_PROVIDER`, `NotificationModule` đang **bind cứng** Simulated (`useClass`); không tự ý gọi provider thật.
- SMS đã bỏ, chỉ email (OTP nếu cần).
- Thêm event mới: thêm `@EventPattern` + (nếu cần) thêm Notification vào danh sách subscriber của Orders.

## Gotchas
- Không idempotent theo event (payload không có eventId) → Outbox phát trùng = email/bản ghi trùng.
- Không retry khi gửi fail (chỉ ghi `FAILED`). Giao event at-most-once (consumer down = mất).
- `PushProvider` đã đăng ký nhưng chưa handler nào gọi. Nội dung email hardcode tiếng Việt, chưa có template.
