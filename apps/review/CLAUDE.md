# Hướng dẫn cho AI Agents - Review Module (AGENTS_GUIDE.md)

## Vai trò
Microservice quản lý đánh giá (rating/comment) của user cho sản phẩm.

## Chức năng chính
- CreateReview: chỉ cho phép nếu user đã mua sản phẩm đó (verify qua Orders service, order ở trạng thái
  từ PAID trở lên và chứa đúng productId).
- GetReviewsByProduct: lấy danh sách review theo productId.

## Kiến trúc CQRS
Áp dụng CQRS (`@nestjs/cqrs`) theo chuẩn chung của dự án — `commands/`, `queries/`, `handlers/`.

## Quy tắc lập trình tại Review Service
- Validate mua hàng qua TCP tới Orders service (`GET_ORDERS` filter theo userId), không tin tưởng
  orderId do client tự khai báo.
