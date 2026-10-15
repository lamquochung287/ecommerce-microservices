# Hướng dẫn cho AI Agents - Promotion Module

## Vai trò
Microservice hybrid quản lý voucher/coupon: TCP :3007 + Kafka consumer group `promotion-service` (chỉ consume `order-events`, không phát event, không chạy outbox relay). **CQRS**.
Chi tiết: [docs/business-flows.md §2.8](../../docs/business-flows.md), [docs/module-processing-flows.md §8](../../docs/module-processing-flows.md), [docs/target-checkout-architecture.md §11.3](../../docs/target-checkout-architecture.md).

## Chức năng
- `CreateVoucher {code unique, discountType PERCENTAGE|FIXED, discountValue>0, minOrderValue≥0, expiresAt, usageLimit>0}` — code trùng → 409.
- `GetVouchers`; `GetAvailableVouchers` (`expiresAt > now`, rồi lọc `usageCount < usageLimit` ở tầng app).
- Kiểm tra + công thức nằm ở `domain/voucher-rules.ts` (hàm thuần, dùng chung Apply/Validate/Reserve). Thứ tự: không có (404) → hết hạn (400) → hết lượt (400) → `orderValue < minOrderValue` (400). Discount: PERCENTAGE `round2(orderValue×v/100)`; FIXED `min(v, orderValue)`.
- `ApplyVoucher {code, orderValue}` (cũ, `POST /vouchers/apply`): 1 TX + `pessimistic_write`, `usageCount += 1`, trả `{code, discountAmount, finalAmount}`. Không gắn đơn nên không có cách trả lượt.
- **Luồng checkout** (Orders gọi qua TCP):
  - `VALIDATE_VOUCHER {code, orderValue}` → `{code, discountAmount}`. Query, không khoá, không ghi.
  - `RESERVE_VOUCHER {code, orderId(uuid), userId(uuid), orderValue}` → `{code, discountAmount}`. 1 TX, `FOR UPDATE` voucher, `usageCount += 1`, insert `voucher_redemptions` RESERVED. Idempotent theo `orderId` (gọi lại trả kết quả cũ, không tăng lần hai). Redemption cùng orderId khác code → 409; redemption đã RELEASED → 409.
  - `RELEASE_VOUCHER {orderId}` → `{released: boolean}`. `RESERVED → RELEASED`, `usageCount -= 1`; trạng thái khác/không có → no-op `{released:false}`.
- **Kafka `order-events`** (inbox khoá `promotion-service` + eventId): `OrderPaid` → `RESERVED → CONFIRMED`; `OrderCancelled{paid:false}` → release; `OrderCancelled{paid:true}` (hoặc thiếu cờ `paid`) và type khác → bỏ qua.

## Quy tắc
- ApplyVoucher/Validate chỉ **tính** discount, không tạo/sửa order. Orders quyết định áp dụng.
- Luôn giữ lock + transaction khi đổi `usageCount`. Thứ tự khoá luôn là voucher rồi redemption (reserve và release) để không deadlock.
- Voucher đã thanh toán (CONFIRMED) không bao giờ được trả lượt, dù đơn bị huỷ/hoàn sau đó.
- Mọi `@MessagePattern` gắn `Transport.TCP`, `@EventPattern` gắn `Transport.KAFKA` (hybrid app).
- Không giới hạn lượt theo user (chưa có yêu cầu).

## Gotchas
- Crash Orders giữa `RESERVE_VOUCHER` và TX tạo đơn → lượt bị giữ vĩnh viễn (redemption RESERVED mồ côi không có event huỷ). Orders release best-effort khi TX lỗi; rủi ro crash được chấp nhận.
- `/vouchers/apply` cũ vẫn tiêu lượt không gắn đơn và không hoàn.
- Code phân biệt hoa/thường; không có `isActive`, không giới hạn theo sản phẩm/danh mục.
- Consumer `fromBeginning:false`: khởi động Promotion trước khi Orders phát event đầu tiên.
- Bảng `voucher_redemptions` do migration `AddVoucherRedemptions` tạo.
