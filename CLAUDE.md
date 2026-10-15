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

- **`apps/gateway`** (HTTP :3000): entry duy nhất, auth/phân quyền/idempotency/throttle, routing TCP. [apps/gateway/CLAUDE.md](./apps/gateway/CLAUDE.md).
- **`apps/user`** (TCP :3001): User, JWT, Role (RBAC bitmask), Address. [apps/user/CLAUDE.md](./apps/user/CLAUDE.md).
- **`apps/orders`** (TCP :3002): Cart (Redis), Order, Refund, Checkout Saga, Outbox. [apps/orders/CLAUDE.md](./apps/orders/CLAUDE.md).
- **`apps/product`** (TCP :3003): Product/Category/Brand/Attribute/Variant + tồn kho. [apps/product/CLAUDE.md](./apps/product/CLAUDE.md).
- **`apps/payment`** (TCP :3004): charge idempotent, webhook HMAC. [apps/payment/CLAUDE.md](./apps/payment/CLAUDE.md).
- **`apps/notification`** (TCP :3005): email theo event Orders. [apps/notification/CLAUDE.md](./apps/notification/CLAUDE.md).
- **`apps/review`** (TCP :3006): review có verify đã mua. [apps/review/CLAUDE.md](./apps/review/CLAUDE.md).
- **`apps/promotion`** (TCP :3007): voucher. [apps/promotion/CLAUDE.md](./apps/promotion/CLAUDE.md).

### Libs (Shared Libraries)

- **`libs/common`**: Chứa các filter cơ sở (như `AbstractRpcExceptionFilter`), module dùng chung.
- **`libs/database`**: Cấu hình TypeORM kết nối với cơ sở dữ liệu PostgreSQL. Các entities được import tự động nếu dùng `autoLoadEntities: true` hoặc thông qua `forFeature`.
- **`libs/cached`**: Chứa cấu hình và module kết nối Redis (sử dụng `ioredis`). Dùng cho caching và các tác vụ yêu cầu tốc độ cao (ví dụ: quản lý token).
- **`libs/constant`**: `PORT_TCP`, `NAME_SERVICE_TCP`, `*_MESSAGE_PATTERN` (mọi pattern TCP), `Action`/`ModuleName` (bitmask phân quyền).
- **`libs/media`**: `MediaService` (MinIO): upload, presigned URL.
- Alias import: `@lib/common`, `@lib/database`, `@lib/cached`, `libs/constant/...`.

## 2.1. Kiến thức hệ thống cần nắm (đã xác minh với code)

Người mới đọc [docs/onboarding-guide.md](./docs/onboarding-guide.md) trước (lộ trình đọc theo mục tiêu). Tài liệu đầy đủ trong `docs/`: [business-flows.md](./docs/business-flows.md) (luồng + rule), [module-processing-flows.md](./docs/module-processing-flows.md) (xử lý chi tiết từng module), [design-trade-offs.md](./docs/design-trade-offs.md) (trade-off + rủi ro), [system-architecture.md](./docs/system-architecture.md).

- **Một DB PostgreSQL chung + một bộ migration** (`libs/database/src/migrations`, mỗi service `migrationsRun:true`, `synchronize:false`). Đổi schema = viết migration (`npm run migration:generate`). Không FK chéo service, tham chiếu bằng UUID.
- **Gọi service**: `{cmd: <pattern>}` qua TCP, host hiện hardcode `localhost`. Gateway→service đi qua `TcpResilienceService` (circuit breaker + timeout 10s); service→service chỉ có `timeout()`.
- **Event giữa service** = Outbox (Orders) + `ClientProxy.emit` tới từng subscriber; **at-most-once**, không dùng `EventBus` của CQRS cho liên-service.
- **Checkout** (`POST /cart/checkout`): Gateway snapshot giá từ Product → Orders Saga: trừ kho (`ADJUST_STOCK`) → Order PENDING → Payment charge (idempotencyKey=orderId) → PROCESSING + Outbox; payment fail/timeout → hoàn kho + CANCELLED (402). Orders nhận `payment_succeeded` (`PaymentEventsController`) và tự chuyển `PROCESSING→PAID`; hết hàng trả 409.
- **Auth**: access 15m + refresh 7d; session = Redis `refresh_token:{userId}:{sessionId}`; Gateway `VERIFY_TOKEN` mỗi request, permissions = OR bitmask role (tính lại mỗi request). Không có endpoint refresh.
- **Gateway** bắt buộc header `x-api-key` cho mọi route (trừ `/health`); `x-idempotency-key` tuỳ chọn cho method ghi.
- **Env**: `validateEnv` bắt buộc `DB_*`, `REDIS_*`, `JWT_*`, `API_KEY`. Tuỳ chọn: `ORDER_TAX_RATE`, `ORDER_SHIPPING_FEE_FLAT`, `CART_TTL_SECONDS`, `PAYMENT_WEBHOOK_SECRET`, `CORS_ORIGINS`, `THROTTLE_LIMIT_DEFAULT`, `THROTTLE_LOGIN_LIMIT` (login/register, mặc định 5/phút/IP), `DB_POOL_MAX/MIN`. Load test k6: [docs/load-testing-guide.md](./docs/load-testing-guide.md).
- **Chạy**: `npm run docker:up` (postgres, redis, jaeger, prometheus, grafana, minio) → `npm run start:all`; `npm run seed` (dữ liệu lớn, mật khẩu `Password123`).
- **Thiết kế đích (CHƯA implement, các mục trên vẫn là hiện trạng)**: checkout reserve kho TTL 15' + payment async (`payment_url`/webhook), Orders orchestrator qua Outbox→**Kafka** (at-least-once + inbox), thêm `apps/inventory` (:3008) và `apps/shipping` (:3009), state machine PENDING_PAYMENT→PAID→FULFILLING→SHIPPED→DELIVERED→COMPLETED (+REFUNDING→REFUNDED). Xem [docs/target-checkout-architecture.md](./docs/target-checkout-architecture.md). Chỉ code theo thiết kế này khi được giao; câu hỏi mở ở §11 của tài liệu đó cần chốt trước.
- **Rủi ro đã biết, không lặp lại khi viết code mới**: tin `unitPrice/userId` từ client ở `POST /orders`; thiếu kiểm tra chủ sở hữu (orders, refunds, addresses); voucher chưa nối checkout; logout không auth. Danh sách đầy đủ: [design-trade-offs.md §5](./docs/design-trade-offs.md).

## 3. Công nghệ Dữ liệu (Tech Stack)

- **Core**: NestJS v11, TypeScript.
- **Database**: PostgreSQL 15 (Docker Compose). Ngoài ra Redis (cache/session/cart/rate-limit/idempotency), MinIO (media), Jaeger + Prometheus + Grafana (observability).
- **ORM**: TypeORM.
- **Caching & In-memory Store**: Redis.
- **Authentication**: JWT (Access Token, Refresh Token), bcrypt (hashing).
- **Design Pattern**: CQRS (`@nestjs/cqrs`) cho product, orders, payment, review, promotion (user & notification không dùng); Saga, Transactional Outbox, optimistic/pessimistic locking, circuit breaker (opossum).

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

_Ghi chú: Cập nhật file này nếu có thêm libs, apps mới, hoặc khi hành vi nghiệp vụ trong §2.1 thay đổi (và cập nhật `docs/` tương ứng). Các quy tắc chi tiết của từng app nên được viết trong `CLAUDE.md` của app đó._
