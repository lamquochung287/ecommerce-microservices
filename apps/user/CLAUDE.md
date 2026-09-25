# Hướng dẫn cho AI Agents - User & Auth Module (AGENTS_GUIDE.md)

## Vai trò
Microservice quản lý thông tin người dùng và quá trình xác thực (Authentication/Authorization).

## Chức năng chính
- Quản lý User (Đăng ký, lấy thông tin profile, cập nhật hồ sơ).
- Xác thực (Đăng nhập, tạo Access/Refresh Token).
- Caching và quản lý session token trên Redis.

## Giao tiếp
- Nhận request từ Gateway qua TCP message pattern (`MessagePattern` hoặc `EventPattern`).
- Xử lý nghiệp vụ, thao tác database và trả kết quả ngược lại Gateway qua TCP.

## Quy tắc lập trình tại User Service
- **Bảo mật**: Luôn dùng `bcrypt` hash mật khẩu trước khi lưu vào Database. Không bao giờ log hoặc trả về mật khẩu gốc.
- **Token Management**:
  - Không lưu Access Token vào Database.
  - Lưu Refresh Token vào Redis (thông qua thư viện `libs/cached`) với TTL cấu hình phù hợp. Khi logout hoặc revoke, xoá key trên Redis để vô hiệu hóa token lập tức.
- **Architecture**: Sử dụng Repository Pattern hoặc CQRS để tương tác với bảng `users` tuỳ mức độ phức tạp, ưu tiên CQRS nếu có nhiều luồng xử lý hoặc side-effects.
