# Hướng dẫn cho AI Agents - Promotion Module

## Vai trò
Microservice TCP :3007 quản lý voucher/coupon. **CQRS**.
Chi tiết: [docs/business-flows.md §2.8](../../docs/business-flows.md), [docs/module-processing-flows.md §8](../../docs/module-processing-flows.md).

## Chức năng
- `CreateVoucher {code unique, discountType PERCENTAGE|FIXED, discountValue>0, minOrderValue≥0, expiresAt, usageLimit>0}` — code trùng → 409.
- `GetVouchers`; `GetAvailableVouchers` (`expiresAt > now`, rồi lọc `usageCount < usageLimit` ở tầng app).
- `ApplyVoucher {code, orderValue}`: 1 transaction + `pessimistic_write` (SELECT FOR UPDATE) để không vượt `usageLimit`. Kiểm tra: không có (404) → hết hạn (400) → hết lượt (400) → `orderValue < minOrderValue` (400). Discount: PERCENTAGE `round2(orderValue×v/100)`; FIXED `min(v, orderValue)`. `usageCount += 1` rồi trả `{code, discountAmount, finalAmount}`.

## Quy tắc
- ApplyVoucher chỉ **tính** discount, không tạo/sửa order. Orders quyết định áp dụng.
- Luôn giữ lock + transaction khi đổi `usageCount`.

## Gotchas
- **Chưa nối vào checkout**: lượt bị tiêu ngay khi apply và **không hoàn** nếu đơn không tạo/bị huỷ; không gắn user nên 1 user apply lặp được; code phân biệt hoa/thường; không có `isActive`, không giới hạn theo sản phẩm/danh mục.
- Hướng tích hợp: gọi apply trong saga `CreateOrder`, lưu `voucherCode/discount` vào Order, thêm bảng redemption theo user + compensation hoàn lượt.
