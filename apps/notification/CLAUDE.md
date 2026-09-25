# Hướng dẫn cho AI Agents - Notification Module (AGENTS_GUIDE.md)

## Vai trò
Microservice gửi thông báo (email, push) cho user khi có sự kiện từ Orders/User. Theo chiến lược
"Simulate trước, Real sau" của roadmap (xem `plans/260925-1612-production-readiness-roadmap/plan.md`).

## Chức năng chính
- `EmailProvider`/`PushProvider` interface, mặc định `SimulatedEmailProvider`/`SimulatedPushProvider`
  (chọn qua env `EMAIL_PROVIDER`/`PUSH_PROVIDER`), không gọi API thật — ghi vào bảng `sent_notifications`
  để assert trong test.
- Lắng nghe event từ Orders (`order.created`, `order.status_updated`) qua TCP `@EventPattern` — Orders
  emit trực tiếp tới TCP client của Notification (xem `apps/orders/src/outbox/outbox.worker.ts`).
- SMS: đã chốt bỏ hẳn, chỉ dùng email OTP (xem Decisions ở `plan.md`).

## Quy tắc lập trình tại Notification Service
- Không tự ý gọi provider thật — mặc định luôn simulate.
- Xử lý event qua interface, không quan tâm simulate hay real provider bên dưới.
