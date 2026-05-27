# Dự án Ecommerce Microservices - Hướng dẫn cho AI Agents (AGENTS.md)

Đây là tài liệu cung cấp ngữ cảnh, cấu trúc và quy tắc ("bộ nhớ") cho AI Agents khi tham gia phát triển dự án này.

## 1. Kiến trúc Hệ thống (System Architecture)

- **Mô hình**: NestJS Monorepo Microservices.
- **Giao thức Giao tiếp (Communication)**:
  - Hiện tại: Giao tiếp nội bộ giữa các microservices được thực hiện qua **TCP** (sử dụng `@nestjs/microservices`).
  - Tương lai: Dự kiến sẽ tích hợp **RabbitMQ** (đã cài đặt `amqp-connection-manager`, `amqplib` nhưng chưa cấu hình).
- **API Gateway**: Entry point duy nhất để clients gọi tới. Gateway nhận HTTP request (RESTful) và phân phối xuống các microservices qua TCP.

## 2. Cấu trúc Thư mục (Directory Structure)

Dự án tuân theo chuẩn NestJS Monorepo, chia làm `apps` (các ứng dụng/services có thể chạy được) và `libs` (các module/thư viện dùng chung).

### Apps

- **`apps/gateway`**: Nhận các request HTTP từ bên ngoài. Sử dụng `HttpExceptionFilter` để xử lý lỗi trả về client.
- **`apps/user`**: Microservice phụ trách User và Authentication. Chứa logic đăng ký, đăng nhập, sinh JWT và băm mật khẩu (bcrypt).
- **`apps/product`**: Microservice quản lý dữ liệu Sản phẩm (Product).
- **`apps/orders`**: Microservice quản lý dữ liệu Đơn hàng (Orders).

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

---

_Ghi chú: Cập nhật file này nếu có thêm libs, apps mới, hoặc khi triển khai chính thức RabbitMQ thay thế/bổ sung cho TCP._
