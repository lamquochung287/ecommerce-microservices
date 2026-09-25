# Hướng dẫn cho AI Agents - Orders Module (AGENTS_GUIDE.md)

## Vai trò
Microservice chịu trách nhiệm quản lý Đơn hàng, giao dịch mua bán, thanh toán, và trạng thái đơn hàng.

## Chức năng chính
- Tạo đơn hàng mới (Checkout - kết hợp kiểm tra giỏ hàng, tồn kho).
- Cập nhật trạng thái đơn hàng (Pending -> Paid -> Processing -> Shipped -> Delivered / Canceled).
- Tính toán tổng tiền, áp dụng mã giảm giá (voucher) nếu có.

## Kiến trúc CQRS & Saga (Giao dịch phân tán)
- Module này **bắt buộc** áp dụng CQRS (`@nestjs/cqrs`).
- Thao tác tạo đơn hàng thường là một giao dịch phân tán (Distributed Transaction). Cần giao tiếp nội bộ thông qua TCP tới:
  - `Product Service`: Để kiểm tra và trừ tồn kho (reserve inventory).
  - `User Service`: Để lấy thông tin khách hàng, kiểm tra/cập nhật điểm thưởng, v.v.
- Khi một bước trong quá trình tạo Order gặp lỗi, cần có cơ chế **Bù trừ (Compensation / Saga)**. (Ví dụ: Nếu trừ tiền/áp mã lỗi, phải hoàn lại tồn kho bên Product).

## Quy tắc lập trình tại Orders Service
- Các thay đổi về trạng thái đơn hàng (Ví dụ: OrderCreated, OrderPaid) nên được publish thành Event (sử dụng `EventBus` trong CQRS và phát ra ngoài qua TCP EventPattern) để các module khác (như Notification, Analytics) có thể lắng nghe.
- Luôn validate chặt chẽ tính toàn vẹn dữ liệu (VD: Sản phẩm có đủ số lượng không, giá sản phẩm từ DB chứ không tin tưởng giá từ client gửi lên) trước khi tạo Order.
