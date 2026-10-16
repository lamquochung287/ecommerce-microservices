# Dự án Ecommerce Microservices - Hướng dẫn cho AI Agents (CLAUDE.md)

Đây là tài liệu cung cấp ngữ cảnh, cấu trúc và quy tắc ("bộ nhớ") cho AI Agents khi tham gia phát triển dự án này.

## 1. Kiến trúc Hệ thống (System Architecture)

- **Mô hình**: NestJS Monorepo Microservices.
- **Giao thức Giao tiếp (Communication)**:
  - **RPC đồng bộ** (Gateway → service, reserve/validate/check giữa service) qua **TCP** (`@nestjs/microservices`).
  - **Event/command bất đồng bộ** giữa service qua **Kafka** (Transactional Outbox → relay at-least-once → consumer có Inbox, retry 3 lần rồi DLQ `<topic>.dlq`). Quyết định "không dùng broker" trước đây đã **bị đảo** khi triển khai checkout v2; RabbitMQ vẫn không dùng. Service tham gia Kafka là app hybrid (TCP + Kafka).
- **API Gateway**: Entry point duy nhất để clients gọi tới. Gateway nhận HTTP request (RESTful) và phân phối xuống các microservices qua TCP.

## 2. Cấu trúc Thư mục (Directory Structure)

Dự án tuân theo chuẩn NestJS Monorepo, chia làm `apps` (các ứng dụng/services có thể chạy được) và `libs` (các module/thư viện dùng chung).

### Apps

*Ghi chú: Xem chi tiết hướng dẫn lập trình cho từng module tại file `CLAUDE.md` bên trong thư mục của module tương ứng.*

- **`apps/gateway`** (HTTP :3000): entry duy nhất, auth/phân quyền/idempotency/throttle, routing TCP. [apps/gateway/CLAUDE.md](./apps/gateway/CLAUDE.md).
- **`apps/user`** (TCP :3001): User, JWT, Role (RBAC bitmask), Address. [apps/user/CLAUDE.md](./apps/user/CLAUDE.md).
- **`apps/orders`** (TCP :3002 + Kafka): Cart (Redis), Order state machine + optimistic lock, checkout v2 (orchestrator), huỷ/hoàn hàng, scheduler, Outbox. [apps/orders/CLAUDE.md](./apps/orders/CLAUDE.md).
- **`apps/product`** (TCP :3003): chỉ catalog Product/Category/Brand/Attribute/Variant (tồn kho đã chuyển sang Inventory). [apps/product/CLAUDE.md](./apps/product/CLAUDE.md).
- **`apps/payment`** (TCP :3004 + Kafka): payment intent idempotent, webhook HMAC → outbox, refund, simulator. [apps/payment/CLAUDE.md](./apps/payment/CLAUDE.md).
- **`apps/notification`** (TCP :3005 + Kafka consumer): email theo event `order-events`. [apps/notification/CLAUDE.md](./apps/notification/CLAUDE.md).
- **`apps/review`** (TCP :3006): review có verify đã mua. [apps/review/CLAUDE.md](./apps/review/CLAUDE.md).
- **`apps/promotion`** (TCP :3007 + Kafka consumer): voucher (validate/reserve/release/confirm). [apps/promotion/CLAUDE.md](./apps/promotion/CLAUDE.md).
- **`apps/inventory`** (TCP :3008 + Kafka): tồn kho `stock_items` + giữ hàng `reservations` (reserve/commit/release/restock, job hết hạn). [apps/inventory/CLAUDE.md](./apps/inventory/CLAUDE.md).
- **`apps/shipping`** (TCP :3009 + Kafka): vận đơn, carrier mô phỏng, webhook giao hàng HMAC. [apps/shipping/CLAUDE.md](./apps/shipping/CLAUDE.md).

### Libs (Shared Libraries)

- **`libs/common`**: Chứa các filter cơ sở (như `AbstractRpcExceptionFilter`), module dùng chung.
- **`libs/database`**: Cấu hình TypeORM kết nối với cơ sở dữ liệu PostgreSQL. Các entities được import tự động nếu dùng `autoLoadEntities: true` hoặc thông qua `forFeature`.
- **`libs/cached`**: Chứa cấu hình và module kết nối Redis (sử dụng `ioredis`). Dùng cho caching và các tác vụ yêu cầu tốc độ cao (ví dụ: quản lý token).
- **`libs/constant`**: `PORT_TCP`, `NAME_SERVICE_TCP`, `*_MESSAGE_PATTERN` (mọi pattern TCP), `Action`/`ModuleName` (bitmask phân quyền).
- **`libs/media`**: `MediaService` (MinIO): upload, presigned URL.
- **`libs/messaging`** (`@lib/messaging`): Kafka — `OutboxWriter`/`OutboxRelayService` (at-least-once, `FOR UPDATE SKIP LOCKED`), `InboxService` (`processed_messages`), `KafkaConsumerRunner` (inbox + transaction + retry + DLQ), `KafkaProducerService`, envelope chuẩn, `ensureKafkaTopics`. Topic/type/consumer group ở `libs/constant/kafka.constant.ts`.
- Alias import: `@lib/common`, `@lib/database`, `@lib/cached`, `libs/constant/...`.

## 2.1. Kiến thức hệ thống cần nắm (đã xác minh với code)

Người mới đọc [docs/onboarding-guide.md](./docs/onboarding-guide.md) trước (lộ trình đọc theo mục tiêu). Tài liệu đầy đủ trong `docs/`: [business-flows.md](./docs/business-flows.md) (luồng + rule), [module-processing-flows.md](./docs/module-processing-flows.md) (xử lý chi tiết từng module), [design-trade-offs.md](./docs/design-trade-offs.md) (trade-off + rủi ro), [system-architecture.md](./docs/system-architecture.md).

- **Một DB PostgreSQL chung + một bộ migration** (`libs/database/src/migrations`, mỗi service `migrationsRun:true`, `synchronize:false`). Đổi schema = viết migration (`npm run migration:generate`), **idempotent** (`IF NOT EXISTS`...). Không FK chéo service, tham chiếu bằng UUID. Bộ migration không dựng được DB trống: DB load test dùng `loadtest/migrate.js` (`schema:sync` + fake migration cũ).
- **Gọi service**: `{cmd: <pattern>}` qua TCP, host hiện hardcode `localhost`. Gateway→service đi qua `TcpResilienceService` (circuit breaker + timeout 10s); service→service chỉ có `timeout()`.
- **Event/command giữa service** = Outbox (`OutboxWriter.append(manager, ...)` cùng transaction với đổi state, key = `orderId`) → relay Kafka **at-least-once** → consumer qua `KafkaConsumerRunner` (Inbox khử trùng theo `eventId`, retry `KAFKA_CONSUMER_MAX_ATTEMPTS`=3, DLQ). Topic: `order-events`, `payment-events`, `payment-commands`, `inventory-commands`, `inventory-events`, `shipping-commands`, `shipping-events`. Không `emit` trực tiếp, không dùng `EventBus` CQRS cho liên-service. App hybrid phải gắn `Transport.TCP` cho `@MessagePattern` và `Transport.KAFKA` cho `@EventPattern`, và gọi `ensureKafkaTopics` trong `main.ts` (broker tắt auto-create topic).
- **State machine đơn**: `PENDING_PAYMENT → PAID → FULFILLING → SHIPPED → DELIVERED → COMPLETED`; huỷ (`PENDING_PAYMENT|PAID|FULFILLING → CANCELLED`, có `cancelReason`); hoàn hàng `DELIVERED → REFUNDING → REFUNDED`. Mọi đổi trạng thái qua `OrderTransitionService` (`UPDATE ... WHERE version`, 0 dòng = lệch version → 409) + Outbox cùng transaction. Không còn `PENDING`/`PROCESSING`.
- **Checkout v2** (`POST /cart/checkout`, **bắt buộc `x-idempotency-key`**): body `{items:[{productId}], shippingAddress, voucherCode?}` — số lượng lấy từ cart, giá từ Product, `userId` từ token (body có `userId/quantity/unitPrice` → 400). Orders: pricing (+voucher validate) → `Inventory.RESERVE` (TTL `ORDER_PAYMENT_TTL_SECONDS`=900, `replaces` các đơn chờ có món trùng) → `Promotion.RESERVE_VOUCHER` → Order `PENDING_PAYMENT` + Outbox → chốt #1 `CHECK_RESERVATION` → `Payment.CREATE_INTENT` → trả `{orderId, status, payment_url, expiresAt}` (hết hàng 409). Cart **không bị xoá** lúc checkout; chỉ trừ đúng món đã đặt khi `PaymentSucceeded`. `GET /orders/:id/pay` = chốt #2 (còn giữ hàng mới trả `{paymentUrl, expiresAt}`).
- **Sau thanh toán** (bất đồng bộ): Payment webhook (HMAC) → `PaymentSucceeded` → Orders `PAID` (+`OrderPaid`, `CommitInventory`) → Inventory `InventoryCommitted` → Orders `FULFILLING` (+`CreateShipment`) → Shipping `ShipmentCreated` → `SHIPPED` → webhook giao hàng `ShipmentDelivered` → `DELIVERED` → scheduler `COMPLETED` sau `ORDER_RETURN_WINDOW_DAYS`=7 ngày. Lỗi: hết hạn 15' / `PaymentFailed` → `CANCELLED` + trả kho; `InventoryCommitFailed` / `ShipmentFailed` (Shipping retry 3 → DLQ) → `CANCELLED` + hoàn tiền; thanh toán muộn vào đơn đã huỷ → hoàn toàn bộ số đã thu; huỷ khi `PAID|FULFILLING` (`POST /orders/:id/cancel`) → hoàn `total − phí ship` + restock; hoàn hàng khi `DELIVERED` (`POST /orders/:id/return`). Voucher: giữ lúc checkout, trả khi đơn **chưa thanh toán** bị huỷ/hết hạn, đã thanh toán thì không trả.
- **Simulator** (Payment/Shipping không gọi dịch vụ ngoài): `/simulator/pay/:intentId` ở Gateway (miễn `x-api-key`, 404 khi `NODE_ENV=production`) đi đúng đường webhook có HMAC; `PAYMENT_SIM_MODE=manual|auto-success|auto-fail`; giao hàng tay `POST /shipments/:orderId/deliver` hoặc `SHIPPING_SIM_DELIVER_DELAY_MS`.
- **Tồn kho** thuộc Inventory (`stock_items`, `reservations`); Product không còn cột `stock`. `GET /products*` ghép `available/stockStatus` (`UNKNOWN` khi Inventory lỗi); điều chỉnh tay `POST /products/:id/stock-adjustments` → `INVENTORY.ADJUST_STOCK`.
- **Auth**: access 15m + refresh 7d; session = Redis `refresh_token:{userId}:{sessionId}`; Gateway `VERIFY_TOKEN` mỗi request, permissions = OR bitmask role (tính lại mỗi request). Không có endpoint refresh.
- **Gateway** bắt buộc header `x-api-key` cho mọi route (trừ `/health` và `/simulator/*`); `GET /products` và `GET /products/:id` công khai (`@Public()`, không cần token; các route khác của Product vẫn cần đăng nhập + quyền); `x-idempotency-key` bắt buộc cho `POST /cart/checkout` (Redis lỗi → 503 fail-closed), tuỳ chọn ở route ghi khác.
- **Env**: `validateEnv` bắt buộc `DB_*`, `REDIS_*`, `JWT_*`, `API_KEY`, **`KAFKA_BROKERS`**, **`PAYMENT_WEBHOOK_SECRET`**, **`SHIPPING_WEBHOOK_SECRET`** (thiếu một biến → mọi service không khởi động). Tuỳ chọn: `ORDER_TAX_RATE`, `ORDER_SHIPPING_FEE_FLAT`, `CART_TTL_SECONDS`, `ORDER_PAYMENT_TTL_SECONDS` (900), `ORDER_RETURN_WINDOW_DAYS` (7), `PUBLIC_API_BASE_URL`, `PAYMENT_SIM_MODE`, `PAYMENT_SIM_DELAY_MS`, `SHIPPING_SIM_MODE`, `SHIPPING_SIM_DELIVER_DELAY_MS`, `INVENTORY_EXPIRY_GRACE_SECONDS`, `KAFKA_TOPIC_PARTITIONS`, `KAFKA_CONSUMER_MAX_ATTEMPTS`, `KAFKA_CONSUMER_RETRY_BACKOFF_MS`, `OUTBOX_RELAY_INTERVAL_MS`, `OUTBOX_MAX_RETRY`, `CORS_ORIGINS`, `THROTTLE_LIMIT_DEFAULT`, `THROTTLE_LOGIN_LIMIT` (login/register, mặc định 5/phút/IP), `BCRYPT_MAX_CONCURRENCY` (4), `BCRYPT_QUEUE_LIMIT` (300), `BCRYPT_QUEUE_WAIT_MS` (8000) (giới hạn bcrypt đồng thời ở User; hàng đợi đầy hoặc chờ quá hạn → 429), `DB_POOL_MAX/MIN`. Load test k6: [docs/load-testing-guide.md](./docs/load-testing-guide.md).
- **Chạy**: `npm run docker:up` (postgres, redis, **kafka**, jaeger, prometheus, grafana, minio, exporter) → `npm run start:all` (10 app). **Backup DB trước** khi bật service trên DB có dữ liệu: migration checkout v2 xoá cột `stock` và đổi enum trạng thái đơn (chạy tự động khi service khởi động). `npm run seed` (dữ liệu lớn, mật khẩu `Password123`) ghi vào DB `ecommerce` theo đường dẫn cứng và chưa chạy lại sau cutover. Khởi động Orders/Inventory/Shipping/Promotion/Notification **trước** khi có event đầu tiên (consumer `fromBeginning:false`; xem lỗi F1 trong [design-trade-offs.md §5 R20](./docs/design-trade-offs.md)).
- **Trạng thái kiểm chứng** (2026-10-15): migration áp trên DB test và dev; 33/33 int-spec pass trên Postgres + Kafka thật; E2E E-01…E-13 PASS. **Chưa kiểm chứng**: E-14 (Kafka tắt), k6 sau cutover, F1. Chi tiết: [docs/target-checkout-architecture.md §10](./docs/target-checkout-architecture.md) và [e2e-test-report.md](./plans/261015-1700-checkout-v2-event-driven/reports/e2e-test-report.md).
- **Rủi ro đã biết, không lặp lại khi viết code mới**: thiếu kiểm tra chủ sở hữu ở `GET /orders*`, `GET /orders/:id/refunds`, addresses; `/vouchers/apply` tiêu lượt không gắn đơn; logout không auth; idempotency Gateway get-then-set không nguyên tử; crash giữa `RESERVE_VOUCHER` và TX tạo đơn làm kẹt lượt voucher; Payment/Shipping là simulator. Đã đóng: tin `unitPrice/userId` từ client (route `POST /orders` đã xoá), voucher chưa nối checkout, outbox at-most-once, Saga trừ kho/charge đồng bộ. Danh sách đầy đủ: [design-trade-offs.md §5](./docs/design-trade-offs.md).

## 3. Công nghệ Dữ liệu (Tech Stack)

- **Core**: NestJS v11, TypeScript.
- **Database**: PostgreSQL 15 (Docker Compose). Ngoài ra Redis (cache/session/cart/rate-limit/idempotency), MinIO (media), Jaeger + Prometheus + Grafana (observability).
- **ORM**: TypeORM.
- **Caching & In-memory Store**: Redis.
- **Authentication**: JWT (Access Token, Refresh Token), bcrypt (hashing).
- **Messaging**: Apache Kafka (KRaft, 1 broker local qua Docker Compose) qua `kafkajs`/`@nestjs/microservices`.
- **Design Pattern**: CQRS (`@nestjs/cqrs`) cho product, orders, payment, review, promotion, inventory, shipping (user & notification không dùng); Orchestration (Orders điều phối bằng event/command), Transactional Outbox + Inbox, optimistic (`version`) / pessimistic locking, circuit breaker (opossum).

## 4. Quy tắc Lập trình (Coding Standards & Rules)

Khi viết code hoặc chỉnh sửa dự án, AI Agents **bắt buộc** phải tuân theo các nguyên tắc sau:

### 4.1. Validation (Kiểm tra dữ liệu)

- Tất cả DTOs bắt buộc phải sử dụng các decorator từ `class-validator` (ví dụ: `@IsString()`, `@IsEmail()`, `@IsNotEmpty()`).
- Ứng dụng đã được thiết lập `ValidationPipe` toàn cục. Không cần tự kiểm tra null/undefined thủ công ở mức controller nếu DTO đã quy định.

### 4.2. Error Handling (Xử lý Ngoại lệ)

- **Trong Microservices**: Xử lý lỗi bằng cách ném (throw) `RpcException({ statusCode, message })` hoặc các lỗi chuẩn của NestJS (`BadRequestException`, `NotFoundException`, v.v.). Mỗi service có một `RpcExceptionFilter` kế thừa `AbstractRpcExceptionFilter` (vd `UserRpcExceptionFilter`) để format lỗi an toàn qua TCP.
- **Trong Gateway**: Sử dụng `HttpExceptionFilter` để map các lỗi nhận được từ Microservices thành HTTP Status Code phù hợp để trả về cho người dùng.

### 4.3. Quản lý Authentication Token

- **Bảo mật**: Mật khẩu **phải** được băm (hash) bằng `bcrypt` trước khi lưu vào PostgreSQL.
- **Quản lý Session**: Sử dụng cơ chế Stateless JWT. Permissions tính lại mỗi request qua User `VERIFY_TOKEN`.
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
