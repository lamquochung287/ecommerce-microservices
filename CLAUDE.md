# Dự án Ecommerce Microservices - Hướng dẫn cho AI Agents (CLAUDE.md)

Đây là tài liệu cung cấp ngữ cảnh, cấu trúc và quy tắc ("bộ nhớ") cho AI Agents khi tham gia phát triển dự án này.

## 1. Kiến trúc Hệ thống (System Architecture)

- **Mô hình**: NestJS Monorepo Microservices.
- **Giao thức Giao tiếp (Communication)**:
  - Giao tiếp nội bộ giữa các microservices được thực hiện qua **TCP** (sử dụng `@nestjs/microservices`).
  - Hệ thống **KHÔNG CÒN DÙNG RabbitMQ**, toàn bộ giao tiếp dựa vào TCP transport.
- **API Gateway**: Entry point duy nhất để clients gọi tới. Gateway nhận HTTP request (RESTful) và phân phối xuống các microservices qua TCP.

## 2. Cấu trúc Thư mục (Directory Structure)

Dự án tuân theo chuẩn NestJS Monorepo, chia làm `apps` (các ứng dụng/services có thể chạy được) và `libs` (các module/thư viện dùng chung).

### Apps

*Ghi chú: Xem chi tiết hướng dẫn lập trình cho từng module tại file `CLAUDE.md` bên trong thư mục của module tương ứng.*

- **`apps/gateway`**: Nhận các request HTTP từ bên ngoài. Xem chi tiết tại [apps/gateway/CLAUDE.md](./apps/gateway/CLAUDE.md).
- **`apps/user`**: Microservice phụ trách User và Authentication. Xem chi tiết tại [apps/user/CLAUDE.md](./apps/user/CLAUDE.md).
- **`apps/product`**: Microservice quản lý dữ liệu Sản phẩm. Xem chi tiết tại [apps/product/CLAUDE.md](./apps/product/CLAUDE.md).
- **`apps/orders`**: Microservice quản lý dữ liệu Đơn hàng. Xem chi tiết tại [apps/orders/CLAUDE.md](./apps/orders/CLAUDE.md).

### Libs (Shared Libraries)

- **`libs/common`**: Chứa các filter cơ sở (như `AbstractRpcExceptionFilter`), module dùng chung.
- **`libs/database`**: Cấu hình TypeORM kết nối với cơ sở dữ liệu PostgreSQL. Các entities được import tự động nếu dùng `autoLoadEntities: true` hoặc thông qua `forFeature`.
- **`libs/cached`**: Chứa cấu hình và module kết nối Redis (sử dụng `ioredis`). Dùng cho caching và các tác vụ yêu cầu tốc độ cao (ví dụ: quản lý token).
- **`libs/constant`**: Quản lý tập trung các biến hằng số toàn cục (ví dụ: `PORT_TCP` định nghĩa cổng TCP cho từng microservice).

## 3. Công nghệ Dữ liệu (Tech Stack)

- **Core**: NestJS v11, TypeScript.
- **Database**: PostgreSQL (quản lý qua Docker Compose).
- **ORM**: TypeORM.
- **Caching & In-memory Store**: Redis.
- **Authentication**: JWT (Access Token, Refresh Token), bcrypt (hashing).
- **Design Pattern**: CQRS (Command Query Responsibility Segregation) sử dụng `@nestjs/cqrs` cho các services phức tạp.

## 4. Quy tắc Lập trình (Coding Standards & Rules)

Khi viết code hoặc chỉnh sửa dự án, AI Agents **bắt buộc** phải tuân theo các nguyên tắc sau:

### 4.1. Validation (Kiểm tra dữ liệu)

- Tất cả DTOs bắt buộc phải sử dụng các decorator từ `class-validator` (ví dụ: `@IsString()`, `@IsEmail()`, `@IsNotEmpty()`).
- Ứng dụng đã được thiết lập `ValidationPipe` toàn cục. Không cần tự kiểm tra null/undefined thủ công ở mức controller nếu DTO đã quy định.

### 4.2. Error Handling (Xử lý Ngoại lệ)

- **Trong Microservices**: Xử lý lỗi bằng cách ném (throw) `RpcException` hoặc các lỗi chuẩn của NestJS (`BadRequestException`, `NotFoundException`, v.v.). Lỗi sẽ được `UserRpcExceptionFilter` (kế thừa `AbstractRpcExceptionFilter`) đón và format lại để truyền an toàn qua TCP.
- **Trong Gateway**: Sử dụng `HttpExceptionFilter` để map các lỗi nhận được từ Microservices thành HTTP Status Code phù hợp để trả về cho người dùng.

### 4.3. Quản lý Authentication Token

- **Bảo mật**: Mật khẩu **phải** được băm (hash) bằng `bcrypt` trước khi lưu vào PostgreSQL.
- **Quản lý Session**: Sử dụng cơ chế Stateless JWT.
- **Thu hồi Token (Revoke)**: Access Token không lưu vào DB. Thay vào đó, Refresh Token được lưu vào **Redis** (sử dụng `libs/cached`) với TTL tương ứng. Khi đăng xuất, mã token trong Redis sẽ bị xóa (`del`) để đảm bảo không thể lấy Access Token mới.

### 4.4. Môi trường và Cấu hình (Config)

- Sử dụng `@nestjs/config` (`ConfigModule` / `ConfigService`) để lấy các biến môi trường từ file `.env`.
- **Không bao giờ** sử dụng trực tiếp `process.env` ở trong logic code.
- File `.env` chứa các config nhạy cảm (JWT Secret, DB credentials, Redis host/port).

### 4.5. Quyết định và Giả định (Decisions & Assumptions)

- **KHÔNG ĐƯỢC tự ý quyết định hoặc đoán mò** khi yêu cầu chưa rõ ràng hoặc thiếu thông tin.
- **BẮT BUỘC phải hỏi lại người dùng** để làm rõ các yêu cầu về nghiệp vụ, logic, cấu trúc hoặc các thay đổi lớn ảnh hưởng tới hệ thống trước khi tiến hành code.

### 4.6. Áp dụng CQRS Pattern

- Các microservices có nghiệp vụ phức tạp (như `product`, `orders`...) bắt buộc phải sử dụng thư viện `@nestjs/cqrs`.
- Cấu trúc thư mục mã nguồn phải tuân thủ việc phân chia rõ ràng: `commands/` (thao tác thay đổi state/dữ liệu), `queries/` (thao tác đọc state/dữ liệu) và `events/`.
- Mỗi Command/Query phải có một Handler (xử lý logic) tương ứng đi kèm (thường đặt trong thư mục `handlers/`).

---

_Ghi chú: Cập nhật file này nếu có thêm libs, apps mới. Các quy tắc chi tiết của từng app nên được viết trong `CLAUDE.md` của app đó._
