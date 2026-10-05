# Ecommerce Microservices System

Kiến trúc NestJS monorepo microservices phục vụ mục đích học tập về distributed systems, CQRS, Saga pattern, và event-driven design. Xây dựng bằng PostgreSQL, Redis, MinIO, và OpenTelemetry observability.

**Trạng thái**: Early-stage (Phase 0/1/2 hoàn thành) | **Deployment**: Local Docker Compose | **Ngôn ngữ**: TypeScript/NestJS v11

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

- **Kiến trúc Microservices**: 8 service độc lập (User, Product, Orders, Payment, Notification, Review, Promotion, Gateway) giao tiếp qua NestJS TCP transport
- **Pattern nâng cao**: CQRS (Command Query Responsibility Segregation), Saga pattern (distributed transaction có compensation), Transactional Outbox (đảm bảo event không mất)
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
| **Cache**         | Redis 7 (session, token, cart, idempotency)                                       |
| **File Storage**  | MinIO (tương thích S3, ảnh sản phẩm, avatar)                                      |
| **Giao tiếp**     | NestJS TCP transport (không dùng message broker; RabbitMQ đã bị deprecated)       |
| **Auth**          | JWT (access 15 phút, refresh 7 ngày) + hash password bằng bcrypt                  |
| **Pattern**       | CQRS, Saga, Outbox, Optimistic/Pessimistic locking, State machine                 |
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
- **Jaeger UI**: http://localhost:16686
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3005 (mặc định: admin/admin) — dashboard "Ecommerce - Server Overview" được provision sẵn từ `grafana/`
- **MinIO Console**: http://localhost:9001 (mặc định: minioadmin/minioadmin)

### 3. Chạy Migration

```bash
npm run typeorm migration:run
```

### 4. Khởi động các Service

**Development (watch mode, tất cả service trong 1 terminal)**:

```bash
npm run start:dev
```

**Production (chạy từng service riêng)**:

```bash
# Terminal 1: Gateway (điểm vào HTTP)
npm run start:prod -- --scope=gateway

# Terminal 2: User Service
npm run start:prod -- --scope=user

# Terminal 3: Product Service
npm run start:prod -- --scope=product

# Terminal 4: Order Service
npm run start:prod -- --scope=orders

# Terminal 5+: payment, notification, review, promotion
npm run start:prod -- --scope=payment
# ... tương tự cho các service còn lại
```

### 5. Truy cập API

- **HTTP Gateway**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api/docs
- **Health Check**: http://localhost:3000/health

### 6. Ví dụ gọi API

```bash
# Đăng ký user
curl -X POST http://localhost:3000/user/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123"}'

# Đăng nhập
curl -X POST http://localhost:3000/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123"}'

# Lấy danh sách sản phẩm (cần JWT trong header Authorization)
curl -X GET http://localhost:3000/products \
  -H "Authorization: Bearer <accessToken>"

# Tạo order (checkout)
curl -X POST http://localhost:3000/orders \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: <unique-key>" \
  -d '{
    "items": [{"productId": "uuid", "quantity": 2}],
    "shippingAddressId": "uuid"
  }'
```

### 7. Chạy Test

```bash
# Unit test (tất cả service)
npm run test

# E2E test
npm run test:e2e

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
├─ Microservices (TCP, port 3001-3007)
│  ├─ USER_SERVICE (:3001) — Auth, profile, role
│  ├─ PRODUCT_SERVICE (:3003) — Catalog, tồn kho
│  ├─ ORDER_SERVICE (:3002) — Cart, Saga checkout, outbox
│  ├─ PAYMENT_SERVICE (:3004) — Charge, webhook
│  ├─ NOTIFICATION_SERVICE (:3005) — Gửi email theo event
│  ├─ REVIEW_SERVICE (:3006) — Review, verify đã mua hàng
│  └─ PROMOTION_SERVICE (:3007) — Voucher
│
└─ Infrastructure (Docker Compose)
   ├─ PostgreSQL (:5432) — Toàn bộ data + outbox
   ├─ Redis (:6379) — Cache, token, cart
   ├─ MinIO (:9000) — File storage tương thích S3
   ├─ Jaeger (:16686) — Distributed tracing
   ├─ Prometheus (:9090) — Metrics
   └─ Grafana (:3005) — Dashboard
```

### Flow chính

**Checkout (Saga Pattern)**:

1. Reserve inventory (Product service)
2. Tạo order trong DB + event outbox (cùng transaction)
3. Charge payment (Payment service, có idempotency key)
4. Confirm order (cập nhật status)
5. OutboxWorker fan-out event tới Notification service

**Authentication**:

1. Login → tạo JWT (access 15 phút) + refresh token (7 ngày, lưu Redis)
2. Mỗi request: Gateway gọi User.VERIFY_TOKEN qua TCP (verify JWT, check session trong Redis, tính permissions)
3. Logout → xoá refresh token khỏi Redis

**Event đáng tin cậy**:

- Transactional outbox: Order ghi data + row outbox trong cùng 1 DB transaction
- OutboxWorker cron: poll các row PENDING, emit qua TCP, đánh dấu PUBLISHED
- Kết quả: không mất event kể cả khi crash

Xem chi tiết diagram và flow tại [`docs/system-architecture.md`](docs/system-architecture.md).

---

## Cấu trúc dự án

```
apps/                          # Các service chạy được (8 apps)
├── gateway/                   # Điểm vào HTTP API (không chứa business logic)
├── user/                      # Auth, profile user, role, RBAC
├── product/                   # Catalog sản phẩm, tồn kho, variant, CQRS
├── orders/                    # Cart, Saga checkout, state machine, outbox, CQRS
├── payment/                   # Charge payment, webhook, idempotency, CQRS
├── notification/              # Gửi email theo event
├── review/                    # Review, rating, verify đã mua hàng, CQRS
└── promotion/                 # Voucher, discount, locking, CQRS

libs/                          # Thư viện dùng chung
├── common/                    # Base filter, config, tracing, utility
├── database/                  # Setup TypeORM, migration, connection pool
├── cached/                    # Redis client, cache service
├── media/                     # MinIO S3 storage, presigned URL
└── constant/                  # Message pattern, port, permission

docs/                          # Tài liệu
├── project-overview-pdr.md            # Tổng quan & PDR (hệ thống làm gì)
├── codebase-summary.md                # Cấu trúc monorepo, tổng quan apps/libs
├── code-standards.md                  # Quy ước code, cấu trúc CQRS, validation, error handling
├── system-architecture.md             # Tổng quan kiến trúc, sơ đồ hệ thống
├── system-architecture-orders-flow.md # Checkout Saga, Outbox, Locking
├── system-architecture-auth-flow.md   # Login, verify token, refresh, logout
├── system-architecture-gateway-flow.md # Middleware chain của Gateway
└── project-roadmap.md                 # Trạng thái hiện tại, phase, gap, next step

docker-compose.yml             # Hạ tầng: Postgres, Redis, Jaeger, Prometheus, Grafana, MinIO
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
| [`docs/system-architecture-orders-flow.md`](docs/system-architecture-orders-flow.md)   | Chi tiết Checkout Saga, Transactional Outbox, Locking                       |
| [`docs/system-architecture-auth-flow.md`](docs/system-architecture-auth-flow.md)       | Chi tiết Login, Verify Token, Refresh, Logout                               |
| [`docs/system-architecture-gateway-flow.md`](docs/system-architecture-gateway-flow.md) | Chi tiết middleware chain của Gateway                                       |
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
- **Phase 1** (Core): User auth, Product catalog, Cart, Order Saga, RBAC, Sổ địa chỉ
- **Phase 2** (Ecosystem): Payment (simulate), Notification, Review, Promotion, MinIO

### Đang làm / TODO 🔄

- **Phase 3** (Production Hardening):
  - Hoàn thiện observability (Jaeger, Prometheus, Grafana dashboard)
  - Payment provider thật (VNPay, MoMo)
  - Email/push provider thật (Resend, FCM)
  - Security audit, API documentation, load testing

### Gap đã biết

- Product catalog chưa có Redis caching (mọi read đều hit Postgres)
- Push notification đã wiring nhưng chưa hoạt động
- `unitPrice` trong order chưa được Orders service tự re-validate lại với giá gốc từ Product (endpoint `/cart/checkout` có che chắn ở Gateway, nhưng `/orders` tạo trực tiếp thì không)
- Chưa implement compensation Refund→Payment
- Chưa có file `.env.example` (gây khó khăn khi onboard)

Xem đầy đủ trạng thái & gap tại [`docs/project-roadmap.md`](docs/project-roadmap.md).

---

## Đóng góp

### Quy ước code

- **Validation**: Mọi DTO dùng decorator `class-validator` (`@IsString()`, `@IsEmail()`, v.v.)
- **Error**: Throw `RpcException` hoặc exception built-in của NestJS, không dùng `Error` thô
- **Config**: Luôn dùng `ConfigService`, không truy cập `process.env` trực tiếp
- **CQRS**: Orders, Product, Payment, Review, Promotion BẮT BUỘC dùng CQRS (commands/queries/handlers); User/Notification chủ ý đơn giản hơn
- **Naming**:
  - File: kebab-case (vd: `create-order.handler.ts`)
  - Class: PascalCase (vd: `CreateOrderHandler`)
  - Biến: camelCase (vd: `productId`)
  - Hằng số: UPPER_SNAKE_CASE (vd: `MAX_STOCK`)
  - Database: snake_case cho table & column

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

**Hỏi: Vì sao không dùng message broker (RabbitMQ)?**
Đáp: Dự án học tập. TCP point-to-point đơn giản hơn; transactional outbox thay thế broker để đảm bảo reliability.

**Hỏi: Vì sao có 2 loại locking (optimistic + pessimistic)?**
Đáp: Trade-off khác nhau. Optimistic phù hợp đọc nhiều (Product stock); pessimistic phù hợp update quan trọng (Promotion voucher).

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

**Cập nhật lần cuối**: 2026-09-28
**Phase đã hoàn thành**: 0, 1, 2
**Phase tiếp theo**: 3 (Production hardening)
