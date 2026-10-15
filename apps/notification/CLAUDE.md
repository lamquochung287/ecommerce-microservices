# Hướng dẫn cho AI Agents - Notification Module

## Vai trò
Microservice hybrid: TCP :3005 + Kafka consumer group `notification-service` (chỉ consume, không phát event, không chạy outbox relay). Gửi thông báo khi có event của Orders. Chiến lược "Simulate trước, Real sau". **Không dùng CQRS** (controller + provider trực tiếp).
Chi tiết: [docs/business-flows.md §2.10](../../docs/business-flows.md), [docs/module-processing-flows.md §6](../../docs/module-processing-flows.md).

## Luồng
`OrderEventsController` có một `@EventPattern('order-events', Transport.KAFKA)` -> `KafkaConsumerRunner.run` (inbox khoá `notification-service` + `eventId`, 1 transaction, retry `KAFKA_CONSUMER_MAX_ATTEMPTS`=3, DLQ `order-events.dlq`). Envelope `{eventId, type, orderId, occurredAt, version, payload}`; ánh xạ type -> nội dung ở `order-event-message.ts`:
- `OrderCreated`, `OrderStatusChanged` (mọi trạng thái, kèm `previousStatus -> status`): gửi email; `OrderPaid`, `OrderCancelled` và type khác: chỉ đánh dấu inbox, không gửi (tránh trùng với `OrderStatusChanged` đi kèm).
1. `User.GET_USER_INFO(userId)` (TCP, làm TRƯỚC khi mở transaction) lấy email; lỗi -> fallback dùng `userId` làm recipient, log warn;
2. `EmailProvider.send` (Simulated: chỉ log) trong `handle`; provider ném lỗi -> rollback inbox, runner retry rồi DLQ; `success:false` -> lưu `FAILED`;
3. ghi `sent_notifications {channel, recipient, subject, body, status SENT|FAILED, sourceEvent}` bằng manager của runner.
`get_sent_notifications {recipient?}` trả lịch sử (chưa có route ở Gateway).

## Quy tắc
- Provider qua DI token `EMAIL_PROVIDER`/`PUSH_PROVIDER`, `NotificationModule` đang **bind cứng** Simulated (`useClass`); không tự ý gọi provider thật.
- SMS đã bỏ, chỉ email (OTP nếu cần).
- Hybrid app: `@MessagePattern` gắn `Transport.TCP`, `@EventPattern` gắn `Transport.KAFKA`; `main.ts` gọi `ensureKafkaTopics`.
- Thêm event mới: thêm `type` vào `order-event-message.ts` (và spec).

## Gotchas
- At-least-once + inbox: event trùng không gửi lại; nhưng nếu commit lỗi sau khi provider đã gửi thì email có thể trùng (provider thật cần idempotency key).
- Event trùng vẫn tốn một lần lookup User (làm trước runner). `fromBeginning:false`: khởi động Notification trước khi Orders relay event đầu tiên.
- `PushProvider` đã đăng ký nhưng chưa handler nào gọi. Nội dung email hardcode tiếng Việt, chưa có template.
- Chưa kiểm chứng trên Kafka/Postgres thật (chỉ unit test với mock).
