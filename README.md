# Ecommerce Microservices System

Kiến trúc NestJS monorepo microservices phục vụ mục đích học tập về distributed systems, CQRS, orchestration event-driven (Outbox/Inbox qua Kafka), và checkout bất đồng bộ. Xây dựng bằng PostgreSQL, Redis, Kafka, MinIO, và OpenTelemetry observability.

**Trạng thái**: Early-stage (Phase 0/1/2 + checkout v2 event-driven đã cutover; migration và int-spec pass trên Postgres/Kafka thật, E2E E-01…E-13 PASS; còn E-14 và k6) | **Deployment**: Local Docker Compose | **Ngôn ngữ**: TypeScript/NestJS v11

---

## Mục lục

- [Dự án này là gì?](#dự-án-này-là-gì)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Kiến trúc](#kiến-trúc)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Tài liệu](#tài-liệu)
- [Trạng thái hiện tại](#trạng-thái-hiện-tại)
- [Đóng góp](#đóng-góp)

---

## Dự án này là gì?

Nền tảng ecommerce phục vụ học tập, minh hoạ:

- **Kiến trúc Microservices**: 10 app độc lập (Gateway, User, Product, Orders, Payment, Notification, Review, Promotion, Inventory, Shipping): RPC đồng bộ qua NestJS TCP, event/command bất đồng bộ qua Kafka
- **Pattern nâng cao**: CQRS, Orchestration (Orders điều phối checkout → thanh toán → kho → vận chuyển), Transactional Outbox + Inbox (at-least-once, consumer idempotent), reserve → commit/release tồn kho
- **Tính nhất quán dữ liệu**: Optimistic & pessimistic locking, state machine, idempotency key
- **Observability**: OpenTelemetry tracing (Jaeger), Prometheus metrics, Grafana dashboard
- **Reliability**: Health check, graceful shutdown, exception filter, circuit breaker

**Chưa sẵn sàng cho production** (chỉ chạy trên localhost; thiết kế để học tập).

---

## Tech Stack

| Layer             | Công nghệ                                                                         |
| ----------------- | --------------------------------------------------------------------------------- |
| **Framework**     | NestJS v11, TypeScript                                                            |
| **Database**      | PostgreSQL 15 (quan hệ)                                                           |
| **Cache**         | Redis (session, token, cart, idempotency, throttle)                               |
| **Messaging**     | Apache Kafka (KRaft, 1 broker local) cho event/command; Outbox/Inbox              |
| **File Storage**  | MinIO (tương thích S3, ảnh sản phẩm, avatar)                                      |
| **Giao tiếp**     | TCP (RPC đồng bộ) + Kafka (event/command bất đồng bộ); không dùng RabbitMQ         |
| **Auth**          | JWT (access 15 phút, refresh 7 ngày) + hash password bằng bcrypt                  |
| **Pattern**       | CQRS, Orchestration, Outbox/Inbox, Optimistic/Pessimistic locking, State machine  |
| **Validation**    | class-validator + global ValidationPipe                                           |
| **Observability** | OpenTelemetry (Jaeger tracing), Prometheus (metrics), Grafana (dashboard)         |
| **Bảo mật**       | Helmet, CORS, rate limiting (lưu Redis), API key, verify webhook bằng HMAC-SHA256 |
| **Permissions**   | RBAC dạng bitmask (role-based access control)                                     |

---

## Quick Start

### Yêu cầu

- Node.js 18+ & npm 9+
- Docker & Docker Compose
- Git

### 1. Clone & Install

```bash
git clone <repo-url>
cd ecommerce-system
npm install
```

### 2. Khởi động hạ tầng

```bash
docker-compose up -d
```

Các service:

- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379
- **Kafka**: localhost:9092 (host) / `kafka:29092` (trong Docker network; tắt auto-create topic, topic do service tạo lúc khởi động)
- **Jaeger UI**: http://localhost:16686
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3100 (mặc định: admin/admin) — 3 dashboard được provision từ `grafana/dashboards/`: "Ecommerce - Server Overview", "Ecommerce - Infrastructure" (PostgreSQL, Redis, Kafka, pipeline nghiệp vụ), "k6 Load Test"
- **Exporter** (không mở cổng ra host): postgres-exporter, redis-exporter, kafka-exporter, nằm trong network compose cho Prometheus
- **MinIO Console**: http://localhost:9001 (mặc định: minioadmin/minioadmin)

### 2b. Tạo file `.env`

Repo không có `.env.example`. Biến **bắt buộc** (thiếu một biến là mọi service không khởi động, xem `libs/common/src/utils/env-validation.ts`):

```
DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
REDIS_HOST REDIS_PORT
JWT_ACCESS_SECRET JWT_ACCESS_EXPIRATION JWT_REFRESH_SECRET JWT_REFRESH_EXPIRATION
API_KEY
KAFKA_BROKERS=localhost:9092
PAYMENT_WEBHOOK_SECRET=<chuỗi bí mật>
SHIPPING_WEBHOOK_SECRET=<chuỗi bí mật>
```

Tuỳ chọn: `ORDER_TAX_RATE`, `ORDER_SHIPPING_FEE_FLAT`, `CART_TTL_SECONDS`, `ORDER_PAYMENT_TTL_SECONDS` (900), `ORDER_RETURN_WINDOW_DAYS` (7), `PUBLIC_API_BASE_URL` (`http://localhost:3000`), `PAYMENT_SIM_MODE` (`manual`\|`auto-success`\|`auto-fail`), `PAYMENT_SIM_DELAY_MS`, `SHIPPING_SIM_MODE` (`success`\|`fail`), `SHIPPING_SIM_DELIVER_DELAY_MS`, `INVENTORY_EXPIRY_GRACE_SECONDS`, `KAFKA_TOPIC_PARTITIONS`, `KAFKA_CONSUMER_MAX_ATTEMPTS` (3), `KAFKA_CONSUMER_RETRY_BACKOFF_MS`, `OUTBOX_RELAY_INTERVAL_MS`, `OUTBOX_MAX_RETRY`, `CORS_ORIGINS`, `THROTTLE_LIMIT_DEFAULT`, `THROTTLE_LOGIN_LIMIT`, `DB_POOL_MAX/MIN`, `NODE_ENV` (`production` tắt simulator).

### 3. Chạy Migration

```bash
npm run migration:run
```

> Migration cũng tự chạy khi mỗi service khởi động (`migrationsRun: true`). Trên DB có dữ liệu thật, **backup trước**: migration checkout v2 xoá cột `stock` và đổi enum trạng thái đơn, `down` không khôi phục đầy đủ. Chi tiết: [docs/database-schema.md §8](docs/database-schema.md).

### 4. Khởi động các Service

**Tất cả 10 app trong 1 terminal** (cần Kafka đã chạy; khởi động trước khi có đơn đầu tiên vì consumer `fromBeginning:false`):

```bash
npm run start:all
```

**Từng app**: `npm run start:gateway|user|product|orders|payment|notification|review|promotion|inventory|shipping`.

**Chạy từng service đã build** (không dùng `start:prod`, script này trỏ tới file không tồn tại):

```bash
npm run build                          # hoặc: npx nest build <app>
node dist/apps/gateway/main.js         # Terminal 1: Gateway (điểm vào HTTP)
node dist/apps/user/main.js            # Terminal 2: User
node dist/apps/orders/main.js          # Orders (TCP + Kafka)
# payment, product, notification, review, promotion, inventory, shipping: tương tự
```

Chạy riêng từng service thì vẫn cần đủ biến `.env` (mục 2b).

### 5. Truy cập API

- **HTTP Gateway**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api/docs
- **Health Check**: http://localhost:3000/health

### 6. Ví dụ gọi API

```bash
# Đăng ký user
curl -X POST http://localhost:3000/user/register \
  -H "x-api-key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123","fullName":"Nguyen Van A"}'

# Đăng nhập
curl -X POST http://localhost:3000/user/login \
  -H "x-api-key: <API_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123"}'

# Lấy danh sách sản phẩm (cần JWT trong header Authorization)
curl -X GET http://localhost:3000/products \
  -H "x-api-key: <API_KEY>" -H "Authorization: Bearer <accessToken>"

# Checkout (chọn món trong giỏ; số lượng lấy từ giỏ, giá lấy từ server).
# Bắt buộc x-api-key và x-idempotency-key; trả payment_url (đơn PENDING_PAYMENT).
curl -X POST http://localhost:3000/cart/items \
  -H "x-api-key: <API_KEY>" -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"productId": "uuid", "quantity": 2}'

curl -X POST http://localhost:3000/cart/checkout \
  -H "x-api-key: <API_KEY>" -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: <unique-key>" \
  -d '{
    "items": [{"productId": "uuid"}],
    "shippingAddress": {"recipientName": "A", "recipientPhone": "0900000000", "addressLine1": "1 Nguyen Hue", "city": "Ho Chi Minh", "country": "VN"}
  }'
```

Sau đó `GET /orders/:id/pay` lấy `paymentUrl`, mở trang `/simulator/pay/:intentId` bấm "Thành công" (hoặc đặt `PAYMENT_SIM_MODE=auto-success`); đơn đi `PAID → FULFILLING → SHIPPED`, giao hàng tay bằng `POST /shipments/:orderId/deliver`. Request mẫu đầy đủ: `http/api-tests.http`.

### 7. Chạy Test

```bash
# Unit test (tất cả service)
npm run test

# Integration test (cần Postgres; Kafka khi INT_KAFKA=1; xem plans/261015-1700-checkout-v2-event-driven/test-cases.md §0)
npm run test:int

# Report coverage
npm run test:cov
```

---

## Kiến trúc

### Tổng quan hệ thống

```
┌─ Clients (Browser/Mobile)
│
├─ API GATEWAY (:3000, HTTP/REST)
│  ├─ Auth (verify JWT)
│  ├─ Rate limiting (Redis)
│  ├─ Idempotency (Redis)
│  └─ Request logging
│
├─ Microservices (TCP :3001-3009; Orders/Payment/Inventory/Shipping/Promotion/Notification còn nối Kafka)
│  ├─ USER_SERVICE (:3001) — Auth, profile, role
│  ├─ ORDER_SERVICE (:3002) — Cart, state machine, checkout v2, huỷ/hoàn hàng, scheduler
│  ├─ PRODUCT_SERVICE (:3003) — Catalog (không còn tồn kho)
│  ├─ PAYMENT_SERVICE (:3004) — Payment intent, webhook, refund, simulator
│  ├─ NOTIFICATION_SERVICE (:3005) — Gửi email theo event
│  ├─ REVIEW_SERVICE (:3006) — Review, verify đã mua hàng
│  ├─ PROMOTION_SERVICE (:3007) — Voucher (validate/reserve/confirm/release)
│  ├─ INVENTORY_SERVICE (:3008) — Tồn kho, reserve/commit/release
│  └─ SHIPPING_SERVICE (:3009) — Vận đơn (carrier mô phỏng)
│
└─ Infrastructure (Docker Compose)
   ├─ PostgreSQL (:5432) — Toàn bộ data + outbox
   ├─ Kafka (:9092) — Event/command giữa các service
   ├─ Redis (:6379) — Cache, token, cart, idempotency
   ├─ MinIO (:9000) — File storage tương thích S3
   ├─ Jaeger (:16686) — Distributed tracing
   ├─ Prometheus (:9090) — Metrics
   └─ Grafana (:3100) — Dashboard
```

### Flow chính

**Checkout v2 (orchestration, event-driven)**:

1. `POST /cart/checkout` (chọn món, idempotency bắt buộc) → Orders tính giá server-side (+ voucher)
2. Inventory **reserve** hàng 15' (TCP) → Order `PENDING_PAYMENT` + outbox (cùng transaction) → kiểm tra còn hàng → Payment tạo intent → trả `payment_url`
3. Thanh toán (simulator, webhook HMAC) → `PaymentSucceeded` (Kafka) → Orders `PAID` → Inventory commit → `FULFILLING` → Shipping tạo vận đơn → `SHIPPED` → giao hàng → `DELIVERED` → tự `COMPLETED` sau 7 ngày
4. Lỗi/huỷ: hết hạn 15' hoặc thanh toán lỗi → `CANCELLED` + trả kho; huỷ khi `PAID`/`FULFILLING` hoặc Shipping lỗi → `CANCELLED` + hoàn tiền (trừ phí ship) + nhập kho lại; hoàn hàng trong 7 ngày sau giao → `REFUNDING → REFUNDED`

**Authentication**:

1. Login → tạo JWT (access 15 phút) + refresh token (7 ngày, lưu Redis)
2. Mỗi request: Gateway gọi User.VERIFY_TOKEN qua TCP (verify JWT, check session trong Redis, tính permissions)
3. Logout → xoá refresh token khỏi Redis

**Event đáng tin cậy**:

- Transactional outbox: ghi state + row outbox trong cùng 1 DB transaction
- Relay mỗi service (`FOR UPDATE SKIP LOCKED`) đẩy Kafka, chỉ đánh dấu `PUBLISHED` sau khi broker ack → at-least-once
- Consumer ghi Inbox (`processed_messages`) cùng transaction, retry 3 lần rồi DLQ `<topic>.dlq`
- Kết quả: không mất event kể cả khi crash/broker tạm tắt; consumer idempotent theo `eventId` và theo trạng thái đơn

Xem chi tiết diagram và flow tại [`docs/system-architecture.md`](docs/system-architecture.md).

---

## Cấu trúc dự án

```
apps/                          # Các service chạy được (10 apps)
├── gateway/                   # Điểm vào HTTP API (không chứa business logic)
├── user/                      # Auth, profile user, role, RBAC
├── product/                   # Catalog sản phẩm, variant, CQRS (không còn tồn kho)
├── orders/                    # Cart, checkout v2, state machine, outbox/inbox, scheduler, CQRS
├── payment/                   # Payment intent, webhook HMAC, refund, simulator, CQRS
├── notification/              # Gửi email theo event Kafka
├── review/                    # Review, rating, verify đã mua hàng, CQRS
├── promotion/                 # Voucher (validate/reserve/confirm/release), CQRS
├── inventory/                 # Tồn kho, reserve/commit/release, job hết hạn, CQRS
└── shipping/                  # Vận đơn, carrier mô phỏng, webhook giao hàng, CQRS

libs/                          # Thư viện dùng chung
├── common/                    # Base filter, config, tracing, utility
├── database/                  # Setup TypeORM, migration, connection pool
├── cached/                    # Redis client, cache service
├── media/                     # MinIO S3 storage, presigned URL
├── messaging/                 # Kafka: outbox relay, inbox, consumer runner, producer
└── constant/                  # Message pattern, Kafka topic/type, port, permission

docs/                          # Tài liệu (xem bảng "Tài liệu" bên dưới)
├── onboarding-guide.md · project-overview-pdr.md · codebase-summary.md
├── business-flows.md · module-processing-flows.md · design-trade-offs.md
├── system-architecture.md · system-architecture-orders-flow.md · system-architecture-gateway-flow.md · system-architecture-auth-flow.md
├── target-checkout-architecture.md · database-schema.md · code-standards.md
└── load-testing-guide.md · project-roadmap.md

plans/                         # Plan và báo cáo kiểm thử checkout v2
grafana/ · monitoring/         # Dashboard Grafana, provisioning, truy vấn tuỳ biến cho postgres-exporter
loadtest/ · http/ · scripts/   # k6 + compose load test · request mẫu · seed.ts

docker-compose.yml             # Hạ tầng: Postgres, Redis, Kafka (KRaft), exporter (postgres/redis/kafka), Jaeger, Prometheus, Grafana, MinIO
package.json                   # Dependencies, script
nest-cli.json                  # Cấu hình monorepo
```

---

## Tài liệu

Bắt đầu từ đây để hiểu hệ thống:

| Tài liệu                                                                               | Mục đích                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`docs/project-overview-pdr.md`](docs/project-overview-pdr.md)                         | Hệ thống làm **gì**, domain nghiệp vụ, mục tiêu, tiêu chí acceptance        |
| [`docs/codebase-summary.md`](docs/codebase-summary.md)                                 | Tìm code ở **đâu**, tóm tắt từng app/lib                                    |
| [`docs/code-standards.md`](docs/code-standards.md)                                     | **Cách** viết code: validation, error, cấu trúc CQRS, naming, testing       |
| [`docs/system-architecture.md`](docs/system-architecture.md)                           | Hệ thống hoạt động **như thế nào**: pattern, flow, data path, observability |
| [`docs/system-architecture-orders-flow.md`](docs/system-architecture-orders-flow.md)   | Chi tiết orchestration checkout v2, Outbox/Inbox Kafka, Locking             |
| [`docs/target-checkout-architecture.md`](docs/target-checkout-architecture.md)         | Thiết kế checkout v2 đã chốt + bảng trạng thái implement/kiểm chứng (§10)   |
| [`docs/system-architecture-auth-flow.md`](docs/system-architecture-auth-flow.md)       | Chi tiết Login, Verify Token, Logout, RBAC (không có refresh endpoint)      |
| [`docs/system-architecture-gateway-flow.md`](docs/system-architecture-gateway-flow.md) | Pipeline Gateway, idempotency, bảng route                                   |
| [`docs/onboarding-guide.md`](docs/onboarding-guide.md)                                 | **Đọc tài liệu theo thứ tự nào**, chạy thử, checklist "đã nắm dự án"        |
| [`docs/business-flows.md`](docs/business-flows.md)                                     | Luồng nghiệp vụ end-to-end, rule, state machine                             |
| [`docs/module-processing-flows.md`](docs/module-processing-flows.md)                   | Xử lý chi tiết từng module                                                  |
| [`docs/design-trade-offs.md`](docs/design-trade-offs.md)                               | Quyết định thiết kế, đánh đổi, rủi ro R1–R20 và câu hỏi mở                  |
| [`docs/database-schema.md`](docs/database-schema.md)                                   | Bảng, quan hệ, index, migration                                             |
| [`docs/load-testing-guide.md`](docs/load-testing-guide.md)                             | k6, sizing VPS 4 vCPU/8 GB, đọc dashboard                                   |
| [`docs/project-roadmap.md`](docs/project-roadmap.md)                                   | Hiện đang **ở đâu**: phase đã xong, gap, next step                          |
| [`CLAUDE.md`](CLAUDE.md)                                                               | Hướng dẫn cho AI agent (rule cấp dự án; đọc trước nếu dùng Claude)          |

Hướng dẫn riêng từng app:

- [`apps/gateway/CLAUDE.md`](apps/gateway/CLAUDE.md)
- [`apps/user/CLAUDE.md`](apps/user/CLAUDE.md)
- `apps/{service}/CLAUDE.md` (tương tự cho từng service)

---

## Trạng thái hiện tại

### Đã hoàn thành ✅

- **Phase 0** (Foundations): Health check, graceful shutdown, migration, idempotency, outbox pattern
- **Phase 1** (Core): User auth, Product catalog, Cart, RBAC, Sổ địa chỉ
- **Phase 2** (Ecosystem): Payment (simulate), Notification, Review, Promotion, MinIO
- **Checkout v2 (event-driven)**: Kafka + Outbox/Inbox, Inventory, Payment intent/webhook/refund, Shipping, voucher nối checkout, huỷ/hoàn hàng, scheduler, Gateway checkout chọn món + idempotency + simulator; Saga cũ đã xoá. Đã kiểm chứng: migration (DB test và dev), 33/33 int-spec trên Postgres + Kafka, E2E E-01…E-13 PASS (`plans/261015-1700-checkout-v2-event-driven/reports/e2e-test-report.md`)

### Đang làm / TODO 🔄

- **Hoàn tất kiểm chứng checkout v2**: E-14 (Kafka tắt), k6 có số đo, seed lại; chọn phương án cho F1 (message bị bỏ khi consumer down)
- **Phase 3** (Production Hardening):
  - Hoàn thiện observability (Jaeger, Prometheus, Grafana dashboard)
  - Payment/Shipping provider thật (hiện chỉ simulator), Email/push provider thật (Resend, FCM)
  - Security audit, API documentation, load testing

### Gap đã biết

- Product catalog chưa có Redis caching (mọi read đều hit Postgres)
- Push notification đã wiring nhưng chưa hoạt động
- `GET /orders`, `GET /orders/:id`, `GET /orders/:id/refunds`, addresses, `POST /user/logout` chưa kiểm tra chủ sở hữu hoặc JWT
- Hoàn tiền `FAILED` không retry được (admin xử lý tay); crash giữa reserve voucher và tạo đơn làm kẹt lượt voucher
- Chưa có file `.env.example` (danh sách biến ở mục 2b)

Xem đầy đủ trạng thái & gap tại [`docs/project-roadmap.md`](docs/project-roadmap.md).

---

## Đóng góp

### Quy ước code

- **Validation**: Mọi DTO dùng decorator `class-validator` (`@IsString()`, `@IsEmail()`, v.v.)
- **Error**: Throw `RpcException` hoặc exception built-in của NestJS, không dùng `Error` thô
- **Config**: Luôn dùng `ConfigService`, không truy cập `process.env` trực tiếp
- **CQRS**: Orders, Product, Payment, Review, Promotion, Inventory, Shipping BẮT BUỘC dùng CQRS (commands/queries/handlers); User/Notification chủ ý đơn giản hơn
- **Naming**:
  - File: kebab-case (vd: `checkout.handler.ts`)
  - Class: PascalCase (vd: `CheckoutHandler`)
  - Biến: camelCase (vd: `productId`)
  - Hằng số: UPPER_SNAKE_CASE (vd: `DEFAULT_TCP_TIMEOUT_MS`)
  - Database: tên bảng snake_case số nhiều (`orders`, `stock_items`); cột theo tên property (camelCase, vd `userId`); khoá ngoại `@JoinColumn({ name: 'order_id' })`
  - Kafka: event type PascalCase (`OrderCreated`), topic kebab-case (`order-events`)

Đọc [`docs/code-standards.md`](docs/code-standards.md) để xem đầy đủ quy tắc.

### Trước khi commit

- [ ] Code tuân thủ quy ước naming
- [ ] Mọi DTO dùng `class-validator`
- [ ] Exception là `RpcException` hoặc built-in của NestJS
- [ ] Không truy cập `process.env` trực tiếp (dùng `ConfigService`)
- [ ] Test coverage ≥70% cho code mới
- [ ] Commit dùng conventional format (feat:, fix:, refactor:, v.v.)

### Lệnh test

```bash
npm run test                 # Unit test
npm run test:watch          # Watch mode
npm run test:cov            # Report coverage
npm run lint                # ESLint
npm run build               # Build TypeScript
```

---

## FAQ

**Hỏi: Vì sao dùng Kafka mà không phải RabbitMQ (và vì sao vẫn còn TCP)?**
Đáp: Ban đầu dự án chỉ dùng TCP; outbox qua TCP chỉ at-most-once nên checkout bất đồng bộ cần broker. Kafka cho event/command (at-least-once + Inbox, partition theo `orderId` giữ thứ tự). RPC cần trả lời ngay (reserve, validate, check) vẫn qua TCP. RabbitMQ không dùng.

**Hỏi: Vì sao có 2 loại locking (optimistic + pessimistic)?**
Đáp: Trade-off khác nhau. Optimistic (`version` trên Order) phù hợp khi tranh chấp thấp và bên thua có thể đọc lại; pessimistic (`FOR UPDATE`) phù hợp reserve kho và voucher.

**Hỏi: Vì sao JWT token là stateless?**
Đáp: Để dễ scale. Refresh token lưu trong Redis cho phép logout/revoke; access token được verify mỗi request qua User service.

**Hỏi: Dự án này đã sẵn sàng production chưa?**
Đáp: Chưa. Chỉ chạy trên localhost. Muốn production cần thêm: deployment (K8s/Docker), vault quản lý secret, payment provider thật, test đầy đủ hơn.

---

## License

MIT

---

## Câu hỏi hoặc vấn đề?

Tham khảo:

- [`docs/project-roadmap.md`](docs/project-roadmap.md) — Trạng thái hiện tại & câu hỏi mở
- [`docs/code-standards.md`](docs/code-standards.md) — Quy ước code
- File `CLAUDE.md` của từng app — Pattern riêng theo domain
- GitHub Issues (nếu dùng GitHub)

---

**Cập nhật lần cuối**: 2026-10-15
**Phase đã hoàn thành**: 0, 1, 2, checkout v2 (code + kiểm chứng trên stack thật một phần)
**Phase tiếp theo**: hoàn tất kiểm chứng checkout v2 (E-14, k6), rồi 3 (Production hardening)
