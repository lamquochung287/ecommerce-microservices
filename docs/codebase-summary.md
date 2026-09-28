# Codebase Summary - Monorepo Structure & Component Overview

**Ngày cập nhật**: 2026-09-28

## Tổng Quan Monorepo

Dự án sử dụng **NestJS Monorepo** pattern với 8 applications (apps/) và 4 shared libraries (libs/). Tất cả source code được quản lý qua một `package.json` gốc và `nest-cli.json` để orchestrate các app/lib riêng lẻ.

```
ecommerce-system/
├── apps/                 # 8 ứng dụng chạy độc lập (có main.ts)
│   ├── gateway/         # HTTP entry point
│   ├── user/            # Authentication & User Management
│   ├── product/         # Product Catalog & Inventory
│   ├── orders/          # Shopping Cart & Orders
│   ├── payment/         # Payment Processing
│   ├── notification/    # Event-driven Notifications
│   ├── review/          # Reviews & Ratings
│   └── promotion/       # Vouchers & Promotions
├── libs/                # Shared libraries (không có main.ts)
│   ├── common/          # Base filters, common config, tracing
│   ├── database/        # TypeORM config & migrations
│   ├── cached/          # Redis client & cache service
│   ├── media/           # MinIO S3-compatible storage
│   └── constant/        # Shared constants (ports, message patterns)
├── docker-compose.yml   # Infrastructure: Postgres, Redis, Jaeger, Prometheus, Grafana, MinIO
├── package.json
├── nest-cli.json
├── tsconfig.json
├── .env                 # Environment variables (gitignored)
└── ...
```

---

## Applications (Apps)

### 1. Gateway (`apps/gateway/`)
**Mục đích**: HTTP API entry point, routing, authentication, rate limiting  
**Kiến trúc**: No CQRS (direct service routing)  
**Kích thước**: ~51 files, ~2,240 LOC

- **Controllers** (16 files): REST endpoints cho tất cả domains (user, product, orders, payment, review, promotion, health)
- **Shared Clients Module**: Đăng ký TCP ClientProxy cho tất cả 7 microservices (USER, ORDER, PRODUCT, PAYMENT, NOTIFICATION, REVIEW, PROMOTION)
- **Interceptors**:
  - `IdempotencyInterceptor`: Redis-backed idempotency (x-idempotency-key header, 24h TTL)
  - `TransformInterceptor`: Wrap response thành `{success, data, error, message, meta}` envelope
- **Guards**:
  - `JwtAuthGuard`: Verify JWT + TCP call tới USER service (5s timeout)
  - `PermissionGuard`: Bitmask permission check (@RequirePermission decorator)
  - `ThrottlerGuard`: Redis-backed rate limiting (100/min default, 5/min cho login/register)
- **Middleware**: RequestTrackerMiddleware (x-request-id, x-api-key enforcement, request log)
- **Error Handling**: `HttpExceptionFilter` (map RPC errors → HTTP status)
- **Observability**: Swagger docs tại /api/docs, OpenTelemetry tracing

### 2. User Service (`apps/user/`)
**Mục đích**: Authentication, user profile, role management  
**Kiến trúc**: Plain services (NO CQRS intentionally)  
**Kích thước**: ~25 files, ~1,098 LOC

- **Entities** (TypeORM):
  - `User`: email unique, bcrypt password, permissions (bitmask legacy), soft-delete
  - `Role`: permissions (bitmask), name unique
  - `UserRole`: join table
  - `Address`: user address book (country, state, city, street, zip), soft-delete
- **Services**:
  - `AuthService`: register (bcrypt hash), login (JWT generate + Redis refresh token), logout, verifyToken
  - `RoleService`: CRUD roles, assign/remove, bitwise-OR permissions resolution
  - `UserService`: get/update profile, avatar URL management
  - `AddressService`: CRUD address, set default (transactional)
- **TCP Patterns**: REGISTER_USER, LOGIN_USER, LOGOUT_USER, VERIFY_TOKEN, GET_USER_INFO, UPDATE_AVATAR, ADDRESS_*, ROLE_*
- **Note**: No CQRS (architectural inconsistency vs. product/orders, but intentional: simple CRUD service)

### 3. Product Service (`apps/product/`)
**Mục đích**: Product catalog, inventory, variants, attributes  
**Kiến trúc**: Full CQRS (commands, queries, events, handlers)  
**Kích thước**: ~56 files, ~1,524 LOC

- **Entities** (TypeORM):
  - `Product`: name, slug (unique), description, price, stock, images (JSONB), @VersionColumn (optimistic lock), soft-delete, FK to Category/Brand
  - `ProductVariant`: sku (unique), price, stock, @VersionColumn, M:N to AttributeValue, soft-delete
  - `Attribute` / `AttributeValue`: 1:N structure for product attributes (color, size, etc.)
  - `Brand`, `Category`: 1:N to Product
- **CQRS Structure**:
  - **Commands**: CreateProduct, UpdateProduct, DeleteProduct, CreateVariant, AdjustStock (most critical)
  - **Queries**: GetProducts (paginated/filterable), GetProduct, GetBrands, GetAttributes, GetVariants
  - **Events**: ProductCreatedEvent (stub: console.log, future Kafka→Elasticsearch)
  - **Handlers**: AdjustStockHandler (optimistic lock retry logic, spec test), etc.
- **Stock Management**:
  - Optimistic locking (@VersionColumn) to prevent race conditions
  - Chỉ có 1 message pattern duy nhất: `ADJUST_STOCK` (nhận `delta`, có thể âm/dương). Orders "reserve" bằng cách gọi `ADJUST_STOCK` với `delta` âm, và "release" (compensation) bằng cách gọi lại chính pattern đó với `delta` dương — **không có RPC riêng cho reserve/release**
  - Low stock threshold tracking
- **TCP Patterns**: PRODUCT_*, VARIANT_*, BRAND_*, ATTRIBUTE_*, ADJUST_STOCK
- **Gap**: No Redis caching (catalog reads hit Postgres every time) — roadmap item

### 4. Orders Service (`apps/orders/`)
**Mục đích**: Shopping cart, order creation (Saga), refunds, outbox pattern  
**Kiến trúc**: Full CQRS + Outbox pattern + State machine  
**Kích thước**: ~48 files, ~1,387 LOC (largest & most complex)

- **Entities** (TypeORM):
  - `Order`: uuid, userId, status (enum), subtotal/taxAmount/shippingFee/totalAmount (decimal riêng biệt, không gộp 1 field), địa chỉ giao hàng snapshot dưới dạng các column phẳng (recipientName, recipientPhone, addressLine1/2, city, province, postalCode, country — không phải nested object), soft-delete (`@DeleteDateColumn`). **Không có `@VersionColumn`** trên Order (chỉ Product/ProductVariant có)
  - `OrderItem`: orderId FK, productId, variantId (nullable), quantity, unitPrice (từ client DTO), tax, discount
  - `Refund`: orderId FK, amount, status (PENDING/APPROVED/REJECTED/COMPLETED), reason
  - `Outbox`: eventType, payload (JSONB), status (PENDING/PUBLISHED/FAILED), retryCount (max 5)
- **CQRS Structure**:
  - **Commands**: CreateOrder (Saga), UpdateOrderStatus, CreateRefund, ApproveRefund, RejectRefund
  - **Queries**: GetOrder, GetOrders (paginated), GetRefunds, GetRefund
  - **Events**: OrderCreatedEvent, OrderStatusUpdatedEvent (stubs)
  - **Handlers**: CreateOrderHandler (Saga), UpdateOrderStatusHandler, RefundHandlers, etc.
- **Checkout Saga (CreateOrderHandler)**:
  1. Reserve inventory: gọi `ADJUST_STOCK` (Product TCP) với delta âm cho từng item; nếu 1 item fail giữa chừng thì compensate bằng cách gọi lại `ADJUST_STOCK` với delta dương cho các item đã trừ trước đó
  2. Create Order+Items in DB tx (status=PENDING) — **transaction riêng, tách khỏi bước 1**
  3. Charge payment via Payment TCP with idempotency key=order.id (compensate khi response trả về fail: release stock + cancel order)
  4. On success: 2nd tx updates status=PROCESSING + writes Outbox row (same tx)
  - **Gap (price-trust)**: bản thân Orders service (`CreateOrderHandler`) tin tưởng hoàn toàn `unitPrice` trong request, không tự gọi Product để re-validate. Gateway có 2 đường gọi tới đây: `POST /cart/checkout` (flow khách hàng bình thường) CÓ set `unitPrice` server-side từ Product trước khi gọi Orders, nhưng `POST /orders` (tạo trực tiếp, quyền admin/`ORDER.CREATE`) thì forward thẳng `unitPrice` client gửi — nên gap thực tế chỉ khai thác được qua đường thứ 2
  - **Gap (failure window)**: bước 1 và bước 2 là 2 transaction riêng biệt — nếu process crash giữa 2 bước, stock đã bị trừ vĩnh viễn nhưng order chưa được tạo (không có outbox event để trigger compensation)
  - **Gap (uncaught exception)**: handler chỉ compensate khi `paymentProvider.capture()` trả về `{success: false}` — nếu TCP call tới Payment timeout/exception (không phải response fail rõ ràng), lỗi sẽ propagate lên không được catch, stock reserved không được release
- **Outbox Pattern**:
  - OutboxWorker cron (@Cron EVERY_SECOND, batch 20): reads PENDING rows, fans out via TCP ClientProxy.emit(), marks PUBLISHED or increments retry
  - Transactional: Order creation + Outbox write in same DB tx = no lost events
- **Cart (Redis-backed)**:
  - Key: `cart:{userId}`, TTL 30 days
  - CRUD via CachedService
- **State Machine** (order-status.constant.ts):
  - Transitions: PENDING → PROCESSING → PAID → SHIPPED → DELIVERED (+ CANCELLED/REFUNDED)
  - Enforced via canTransition() check, each transition writes Outbox event
- **TCP Patterns**: CREATE_ORDER, UPDATE_ORDER_STATUS, GET_ORDER, GET_ORDERS, CREATE_REFUND, APPROVE_REFUND, REJECT_REFUND, etc.
- **Gaps**: 
  - Refund→Payment compensation (money return) not implemented (status bookkeeping only)
  - Full refund on PAID/SHIPPED order won't auto-transition to REFUNDED (state machine edge case)

### 5. Payment Service (`apps/payment/`)
**Mục đích**: Payment processing, webhook handling, idempotency  
**Kiến trúc**: Minimal CQRS (no events, direct TCP emit)  
**Kích thước**: ~18 files, ~407 LOC

- **Entities** (TypeORM):
  - `PaymentTransaction`: orderId, idempotencyKey (unique), status (SUCCEEDED/FAILED), amount, failureReason (nullable), createdAt
  - `PaymentWebhookLog`: eventId (unique), orderId, processedAt — chỉ 4 field, dùng thuần cho dedup (không có cột provider/signature/status)
- **CQRS Structure**:
  - **Commands**: ChargePayment, HandlePaymentWebhook
  - **Queries**: GetTransaction
  - **NO Events folder** — emit directly via TCP ClientProxy.emit()
- **Providers**:
  - `PaymentProvider` interface (charge, verifyWebhook)
  - `SimulatedPaymentProvider` (always succeeds, default)
  - **Planned (scaffold only, not implemented)**: vnpay, momo (via env PAYMENT_PROVIDER)
- **Charge Flow**:
  - Idempotent via idempotencyKey (unique constraint)
  - Calls provider → persists transaction → emits payment_succeeded/payment_failed to Orders TCP
- **Webhook Flow**:
  - Gateway POST /webhooks/payments (no JWT, HMAC-SHA256 verified via PAYMENT_WEBHOOK_SECRET env)
  - Dedup via PaymentWebhookLog.eventId
  - Currently only logs (does NOT update PaymentTransaction status) — source of truth is charge path
- **TCP Patterns**: CHARGE_PAYMENT, HANDLE_PAYMENT_WEBHOOK, GET_TRANSACTION

### 6. Notification Service (`apps/notification/`)
**Mục đích**: Event-driven notifications (email, push)  
**Kiến trúc**: Plain event listeners (intentionally NO CQRS)  
**Kích thước**: ~13 files, minimal LOC

- **Entity**:
  - `SentNotification`: channel (EMAIL/PUSH), status (SENT/FAILED), sourceEvent, userId, content
- **Event Listeners** (TCP @EventPattern):
  - `order-events.controller.ts`:
    - `order.created` → resolve user email via User TCP (GET_USER_INFO) → send via EmailProvider
    - `order.status_updated` → similar flow
- **Providers**:
  - `EmailProvider` interface (send)
  - `SimulatedEmailProvider` (logs only, default)
  - `PushProvider` interface (sendPush)
  - `SimulatedPushProvider` (logs only, wired in DI but NEVER CALLED — push notifications non-functional)
  - **Planned (scaffold only)**: Resend/Brevo for email, FCM for push
- **Note**: "Simulate first, real later" strategy per CLAUDE.md; SMS explicitly dropped from scope
- **Gap**: PushProvider wired but never invoked by any controller

### 7. Review Service (`apps/review/`)
**Mục đích**: Product reviews & ratings with purchase verification  
**Kiến trúc**: Full CQRS  
**Kích thước**: ~13 files, minimal LOC

- **Entity**:
  - `Review`: unique [userId, productId, orderId], rating (int), comment (nullable). **Không có soft-delete** (không có `@DeleteDateColumn`)
- **CQRS Structure**:
  - **Commands**: chỉ có `CreateReview` — **chưa có Update/Delete command hay handler**
  - **Queries**: `GetReviewsByProduct` (theo productId)
- **Purchase Verification**:
  - CreateReviewHandler calls Orders TCP (GET_ORDER) to verify:
    - Order belongs to claimed user
    - Order status is PAID/SHIPPED/DELIVERED
    - Order items contain claimed productId
  - Server-side verification (doesn't trust client-supplied combo)
- **TCP Patterns**: `CREATE_REVIEW`, `GET_REVIEWS_BY_PRODUCT` (chỉ 2 pattern — không có GET_REVIEWS/DELETE_REVIEW), gọi outbound `GET_ORDER` tới Orders

### 8. Promotion Service (`apps/promotion/`)
**Mục đích**: Voucher management & discount calculation  
**Kiến trúc**: Full CQRS, self-contained  
**Kích thước**: ~16 files, minimal LOC

- **Entity**:
  - `Voucher`: code (unique), discountType (PERCENTAGE/FIXED), discountValue, minOrderValue, expiresAt, usageLimit, usageCount
- **CQRS Structure**:
  - **Commands**: CreateVoucher, UpdateVoucher, ApplyVoucher (calculates discount)
  - **Queries**: GetVouchers, GetVoucher
- **Concurrency Safety**:
  - ApplyVoucherHandler uses pessimistic_write row lock on voucher in DB tx
  - Validates: expiry, usageLimit, minOrder
  - Increments usageCount atomically
- **No Outbound Calls**: Fully self-contained (Orders decides whether to apply discount returned)
- **TCP Patterns**: CREATE_VOUCHER, GET_VOUCHERS, APPLY_VOUCHER

---

## Shared Libraries (Libs)

### `libs/common/`
**Mục đích**: Base exception filters, common config, tracing setup  
**Kích thước**: ~15 files, ~600 LOC

- **Exception Handling**:
  - `AbstractRpcExceptionFilter`: Base class converts HttpException/TypeORM errors (23505 unique, 23502 FK, 23503 not null, class-validator) → RpcException (statusCode, message, error, timestamp)
  - Per-service subclass (e.g., UserRpcExceptionFilter) overrides getUniqueConstraintMessage()
- **Configuration**:
  - `CommonConfigModule`: ConfigModule.forRoot global + env validation
  - Required env vars: DB_HOST/PORT/USER/PASSWORD/NAME, REDIS_HOST/PORT, JWT_ACCESS_SECRET/EXPIRATION, JWT_REFRESH_SECRET/EXPIRATION, API_KEY
- **Utilities**:
  - `PaginationQueryDto` / `PaginatedResult<T>`: DTO for paginated queries + response
  - `setupTracing()`: OpenTelemetry + Prometheus metrics initialization (called in every app's main.ts with unique metrics port)
- **Note**: `src/constant/cmd.ts` (CMD object) looks like stale duplicate of `libs/constant/message-pattern.constant.ts` — flag as dead code

### `libs/database/`
**Mục đích**: TypeORM configuration, migrations, database setup  
**Kích thước**: ~20 files (including migrations)

- **DatabaseModule**:
  - `TypeOrmModule.forRootAsync()` with config factory
  - `autoLoadEntities: true` (auto-discovers entities from importing modules)
  - `synchronize: false` (use migrations, never auto-schema-sync)
  - `migrationsRun: true` (auto-run pending migrations on app start)
  - Connection pool: max:50, min:5, idleTimeout:30s, connectionTimeout:5s
- **Database**: PostgreSQL 15 (via docker-compose)
- **Migrations** (8 total, in `src/migrations/`):
  1. InitSchema (users, roles, initial structure)
  2. AddOutboxTable (orders.outbox)
  3. AddProductCatalogEntities (products, brands, categories, attributes, variants)
  4. DropProductVersionColumnDefault (schema cleanup)
  5. AddOrderSagaAndRefund (order statuses, refund table)
  6. AddRbacAndAddressBook (user roles detail, address table)
  7. AddPaymentNotificationReviewPromotion (payment, notification, review, promotion schemas)
  8. AddUserAvatarUrl (user avatar_url column)
- **DataSource**: TypeORM CLI config for migrations (`src/data-source.ts`)

### `libs/cached/`
**Mục đình**: Redis client, caching service, health indicator  
**Kích thước**: ~8 files, ~200 LOC

- **CachedModule**: @Global, ioredis client initialization
- **CachedService**:
  - `set(key, value, ttl?)`: store with optional TTL
  - `get(key)`: retrieve (returns parsed JSON or null)
  - `del(key)`: delete
- **RedisHealthIndicator**: Health check integration (terminus)
- **Retry Strategy**: Configured in ioredis client (exponential backoff)
- **Used for**:
  - Cart storage (`cart:{userId}`)
  - Refresh tokens (`refresh_token:{userId}:{sessionId}`)
  - Rate-limit tracking (ThrottlerGuard)
  - Idempotency key dedup (IdempotencyInterceptor)
  - Future: product catalog caching (roadmap)

### `libs/media/`
**Mục đích**: MinIO (S3-compatible) file upload & presigned URLs  
**Kích thước**: ~8 files, ~150 LOC

- **MediaModule**: @Global
- **MinIO Client Setup**:
  - Auto-creates 'ecommerce-media' bucket on init
  - Host: MINIO_HOST env, port: MINIO_PORT, credentials: MINIO_ROOT_USER/PASSWORD
- **MediaService**:
  - `uploadFile(file, folder)`: Upload to MinIO, return object path (not full URL)
  - `getPresignedUrl(objectPath, expirySeconds)`: Generate temporary download URL
- **Usage**: Product images, user avatars uploaded here
- **Docker**: MinIO container in docker-compose.yml (port 9000 API, 9001 console)

### `libs/constant/`
**Mục đích**: Shared constants (ports, message patterns, permissions)  
**Structure**: Flat files (no `src/` subdirectory, not in nest-cli.json as lib project)

- **`port-tcp.constant.ts`** (tên export thật là `PORT_TCP`, key có hậu tố `_TCP_PORT`):
  ```ts
  export const PORT_TCP = {
    USER_TCP_PORT: 3001,
    ORDER_TCP_PORT: 3002,
    PRODUCT_TCP_PORT: 3003,
    PAYMENT_TCP_PORT: 3004,
    NOTIFICATION_TCP_PORT: 3005,
    REVIEW_TCP_PORT: 3006,
    PROMOTION_TCP_PORT: 3007,
  };
  ```
- **`message-pattern.constant.ts`** (canonical, supersedes libs/common's stale CMD):
  - Message pattern objects per domain (USER_MESSAGE_PATTERN, ORDER_MESSAGE_PATTERN, etc.)
  - Key không có prefix domain (vd: `CREATE_ORDER`, không phải `ORDER_CREATE`), giá trị string là snake_case không dấu chấm (vd: `'create_order'`) — khác với `ORDER_EVENT_TYPE` (dùng dot-notation như `'order.created'`) là hằng số riêng cho **outbox event type**, không phải RPC message pattern
  - Used in Gateway's ClientsModule registration + service route definitions
- **`permission.constant.ts`** (chi tiết đầy đủ xem [code-standards.md](./code-standards.md#permission-model)):
  - `Action` enum (bitmask, bit 0-3): NONE=0, CREATE=1, READ=2, UPDATE=4, DELETE=8, ALL=15
  - `ModuleName` enum (bit 4 trở lên, **cố ý không overlap** với Action): USER=16, PRODUCT=32, ORDER=64, CAMPAIGN=128, PAYMENT=256, REVIEW=512, PROMOTION=1024
  - Kết hợp bằng OR thường: `ModuleName.PRODUCT | Action.READ` (không shift thêm 8 bit)
  - Permission check: `(userPermissions & required) === required`

---

## Infrastructure & External Services

### Docker Compose (`docker-compose.yml`)
Services (all on localhost):
- **PostgreSQL 15**: db:5432, persistent volume
- **Redis 7**: cache:6379
- **Jaeger**: 16686 (UI), 4317 (gRPC OTLP), 4318 (HTTP OTLP)
- **Prometheus**: prometheus:9090
- **Grafana**: grafana:3005 (maps to 3000 inside container)
- **MinIO**: minio:9000 (API), 9001 (console, default login minioadmin/minioadmin)

### NestJS App Ports
- **Gateway**: :3000 (HTTP public entry point)
- **User Service**: :3001 (TCP)
- **Order Service**: :3002 (TCP)
- **Product Service**: :3003 (TCP)
- **Payment Service**: :3004 (TCP)
- **Notification Service**: :3005 (TCP)
- **Review Service**: :3006 (TCP)
- **Promotion Service**: :3007 (TCP)

### Metrics Ports (OpenTelemetry Prometheus)
- Gateway: 9464
- Notification: 9469
- Review: 9470
- Promotion: 9471
- (Others likely follow pattern 94XX)

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| **Framework** | NestJS v11, TypeScript |
| **Database** | PostgreSQL 15 + TypeORM |
| **Cache/Session** | Redis 7 + ioredis |
| **File Storage** | MinIO (S3-compatible) |
| **Auth** | JWT (15m access, 7d refresh), bcrypt (password hashing) |
| **Design Pattern** | CQRS (@nestjs/cqrs) — mandatory for complex services |
| **Data Patterns** | Saga (Orders checkout), Outbox (transactional event publishing), Optimistic locking (Product stock) |
| **Communication** | NestJS TCP transport (no RabbitMQ) |
| **Validation** | class-validator + global ValidationPipe |
| **Observability** | OpenTelemetry (Jaeger tracing), Prometheus (metrics), Grafana (dashboards) |
| **API Documentation** | Swagger (@nestjs/swagger) at /api/docs |
| **Security** | Helmet, CORS, HMAC-SHA256, API key, rate limiting (Throttler + Redis), bitmask RBAC |

---

## Known Gaps & Roadmap Items

1. **Product service**: Zero Redis caching (all reads hit Postgres) — opportunity for performance improvement
2. **Event handlers**: ProductCreatedEvent, OrderCreatedEvent are console.log stubs (future Kafka→Elasticsearch sync)
3. **Payment**: Only SimulatedPaymentProvider exists; real vnpay/momo scaffold only
4. **Notification**: PushProvider wired but never called (push notifications non-functional)
5. **Dependencies**: amqp-connection-manager/amqplib in package.json but RabbitMQ is fully deprecated — cleanup candidate
6. **Orders**: `CreateOrderHandler` never re-validates `unitPrice` against Product's canonical price — Gateway's `/cart/checkout` happens to protect against this by fetching price from Product first, but the direct `POST /orders` endpoint forwards client-supplied `unitPrice` unchecked (price-trust gap at the Orders-service level, not fully mitigated by Gateway)
7. **Refunds**: No refund→payment compensation/money-return mechanism found (currently status bookkeeping only)
8. **Order state machine**: Full refund on PAID/SHIPPED order won't auto-transition to REFUNDED (edge case)
9. **Env documentation**: No `.env.example` exists in repo root (user onboarding friction)
10. **User service**: Lacks CQRS (architectural inconsistency vs. other services, may be intentional for simple CRUD)
11. **Auth**: No explicit refresh-token rotation/renewal endpoint — Gateway's JwtAuthGuard verifies via User.VERIFY_TOKEN, but client-side renewal flow unclear

---

## Statistics

| Component | Files | Est. LOC | Pattern |
|-----------|-------|---------|---------|
| **Gateway** | 51 | 2,240 | No CQRS (routing-heavy) |
| **User** | 25 | 1,098 | Plain services (no CQRS) |
| **Product** | 56 | 1,524 | Full CQRS |
| **Orders** | 48 | 1,387 | Full CQRS + Outbox + Saga |
| **Payment** | 18 | 407 | Minimal CQRS |
| **Notification** | 13 | ~200 | Event listeners (no CQRS) |
| **Review** | 13 | ~200 | Full CQRS |
| **Promotion** | 16 | ~250 | Full CQRS |
| **Libs** (all) | ~70 | ~1,200 | Utilities, config, patterns |
| **Total** | ~310 | ~8,500 | Mixed patterns by domain |

---

## How to Navigate This Codebase

1. **Understanding Startup**: Read `apps/gateway/main.ts` (entry HTTP), then trace TCP connections to one microservice (e.g., `apps/user/main.ts`)
2. **Understanding CQRS**: Start with `apps/product/src/commands/` (simple CRUD), then `apps/orders/src/commands/create-order.handler.ts` (Saga complexity)
3. **Understanding Data Flow**: Trace a checkout request: Gateway controller → Orders TCP → Product TCP (reserve) → Payment TCP (charge) → Outbox worker → Notification TCP
4. **Understanding Observability**: Check `setupTracing()` call in any app's main.ts, then view Jaeger at http://localhost:16686
5. **Database Schema**: Run migrations via `npm run typeorm -- migration:show`, view schema in Postgres directly, or check `libs/database/src/migrations/`
