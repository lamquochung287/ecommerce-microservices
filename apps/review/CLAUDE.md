# Hướng dẫn cho AI Agents - Review Module

## Vai trò
Microservice TCP :3006 quản lý đánh giá (rating 1–5 + comment) của user cho sản phẩm. **CQRS** (`commands/`, `queries/`, `handlers/`).
Chi tiết: [docs/business-flows.md §2.9](../../docs/business-flows.md), [docs/module-processing-flows.md §7](../../docs/module-processing-flows.md).

## Luồng CreateReview
Gọi **`Orders.GET_ORDER {id: orderId}`** (timeout 10s) rồi kiểm tra: order tồn tại (404) **và** `order.userId === userId` **và** `status ∈ {PAID,SHIPPED,DELIVERED}` **và** `items` chứa `productId` — sai bất kỳ điều kiện → 403. Rồi lưu; unique `(userId, productId, orderId)` chặn review trùng (message do `ReviewRpcExceptionFilter`).
`GetReviewsByProduct`: mới nhất trước, không phân trang, không tính rating trung bình.

## Quy tắc
- Không tin `userId/productId/orderId` client khai — luôn verify qua Orders (không dùng `GET_ORDERS`).
- `CANCELLED`/`REFUNDED`/`PENDING`/`PROCESSING` không được review.

## Gotchas
- `userId` lấy từ body DTO, **không** từ JWT ở Gateway (chỉ được bảo vệ gián tiếp vì phải khớp `order.userId`). Nên ép `userId = req.user.userId` ở Gateway.
- Phụ thuộc đồng bộ vào Orders (down = không review được), không có breaker. Không cập nhật rating tổng hợp sang Product.
