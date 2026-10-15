# Codebase Summary - Monorepo Structure & Component Overview

**Ngày cập nhật**: 2026-10-15 (sau cutover checkout v2)

> **Trạng thái kiểm chứng**: code, unit test (mock) và `nest build` của cả 10 app đã xong; migration, int-spec (Postgres), seed, load test và e2e qua Kafka **chưa chạy trên stack thật** trong lần cutover này. Số liệu LOC cũ đã bỏ (không còn đo lại).

## Tổng Quan Monorepo

Dự án dùng **NestJS Monorepo** với 10 applications (`apps/`) và 6 shared libraries (`libs/`), quản lý qua một `package.json` gốc và `nest-cli.json`.

```
ecommerce-system/
├── apps/                 # 10 ứng dụng chạy độc lập (có main.ts)
│   ├── gateway/         # HTTP :3000 — entry point, auth, idempotency, simulator
│   ├── user/            # TCP :3001 — Authentication, RBAC, Address
│   ├── orders/          # TCP :3002 + Kafka — Cart, state machine, checkout v2, scheduler
│   ├── product/         # TCP :3003 — Catalog (không còn tồn kho)
│   ├── payment/         # TCP :3004 + Kafka — payment intent, webhook, refund
│   ├── notification/    # TCP :3005 + Kafka — email theo order-events
│   ├── review/          # TCP :3006 — Reviews
│   ├── promotion/       # TCP :3007 + Kafka — Voucher
│   ├── inventory/       # TCP :3008 + Kafka — stock_items, reservations
│   └── shipping/        # TCP :3009 + Kafka — vận đơn, carrier mô phỏng
├── libs/                # Shared libraries (không có main.ts)
│   ├── common/          # Base filters, env validation, tracing
│   ├── database/        # TypeORM config & migrations
│   ├── cached/          # Redis client & cache service
│   ├── media/           # MinIO S3-compatible storage
│   ├── messaging/       # Kafka: outbox/inbox, consumer runner, producer, topics
│   └── constant/        # Ports, message patterns, Kafka topics/types, permissions
├── docker-compose.yml   # Postgres, Redis, Kafka (KRaft), exporter (postgres/redis/kafka), Jaeger, Prometheus, Grafana, MinIO
├── scripts/seed.ts      # Seed dữ liệu lớn (products + stock_items, orders theo state machine mới)
├── loadtest/            # k6 + docker compose load test (10 app)
├── http/api-tests.http  # Request mẫu (checkout v2, simulator, huỷ/hoàn, giao hàng)
├── plans/               # Plan + báo cáo từng phase của checkout v2
├── package.json · nest-cli.json · tsconfig.json
└── .env                 # Biến môi trường (gitignored; không có .env.example)
```

---

## Applications (Apps)

### 1. Gateway (`apps/gateway/`)
**Mục đích**: HTTP API entry point, routing, authentication, rate limiting, idempotency, simulator trang thanh toán.
**Kiến trúc**: No CQRS (direct service routing).

- **Controllers**: REST cho user, product (ghép tồn kho từ Inventory), orders (`GET /orders*`), customer orders (`GET /orders/:id/pay`, `POST /orders/:id/cancel`, `POST /orders/:id/return`), cart (`POST /cart/checkout`), payment (`/webhooks/payments`, `/payments/:orderId/transaction`, `/simulator/pay/:intentId`), shipping (`/webhooks/shipping`, `/shipments/:orderId[/deliver]`), review, promotion, health.
- **Shared Clients Module**: `ClientProxy` TCP cho USER, ORDER, PRODUCT, PAYMENT, NOTIFICATION, REVIEW, PROMOTION, INVENTORY, SHIPPING.
- **Interceptors**: `IdempotencyInterceptor` (Redis; checkout bắt buộc header, fail-closed 503; key scope user+path), `TransformInterceptor` (envelope `{success, data, error, message, meta}`).
- **Guards**: `JwtAuthGuard` (TCP `VERIFY_TOKEN`, 5s), `PermissionGuard` (bitmask), `ThrottlerGuard` (Redis; 100/min, login/register 5/min).
- **Middleware**: `RequestTrackerMiddleware` (`x-request-id`, `x-api-key` bắt buộc; miễn `/health`, `/simulator/*`).
- **Đã xoá ở cutover**: `POST /orders`, `PATCH /orders/:id/status`, `refund.controller.ts` (`/refunds*`).

### 2. User Service (`apps/user/`)
**Mục đích**: Authentication, user profile, role management. **Kiến trúc**: plain services (cố ý không CQRS).

- **Entities**: `User` (email unique, bcrypt, permissions legacy, soft-delete), `Role` (bitmask), `UserRole`, `Address`.
- **Services**: `AuthService`, `RoleService`, `UserService`, `AddressService`.
- **TCP Patterns**: REGISTER_USER, LOGIN_USER, LOGOUT_USER, VERIFY_TOKEN, GET_USER_INFO, UPDATE_AVATAR, ADDRESS_*, ROLE_*.

### 3. Product Service (`apps/product/`)
**Mục đích**: **chỉ catalog** — Product, Category, Brand, Attribute/AttributeValue, Variant. **Kiến trúc**: Full CQRS.

- **Entities**: `Product` (slug unique, price, lowStockThreshold, images JSONB, `@VersionColumn`, soft-delete), `ProductVariant` (sku unique, price?, `@VersionColumn`), `Attribute`/`AttributeValue`, `Brand`, `Category`. **Không còn cột `stock`** (tồn kho ở Inventory).
- **CQRS**: Commands CreateProduct/UpdateProduct/DeleteProduct/CreateVariant/UpdateVariant/DeleteVariant/Brand/Attribute…; Queries GetProducts (sort `name|price|createdAt`), GetProduct, GetBrands, GetAttributes, GetVariants; Event ProductCreatedEvent (stub `console.log`). `AdjustStock` **đã xoá** (chuyển sang `INVENTORY.ADJUST_STOCK`).
- **Gap**: chưa cache Redis cho catalog.

### 4. Orders Service (`apps/orders/`)
**Mục đích**: Cart, checkout v2 (orchestrator), state machine + khoá lạc quan, huỷ/hoàn hàng, scheduler. **Kiến trúc**: Full CQRS + Outbox/Inbox (Kafka). App hybrid TCP :3002 + Kafka group `orders-service`.

- **Entities**: `Order` (9 trạng thái, `version`, `expiresAt/paidAt/deliveredAt`, `cancelReason`, `refundStatus/refundedAmount/refundedAt`, `paymentIntentId/paymentCheckoutUrl`, `trackingCode`, `voucherCode/discountAmount`, snapshot địa chỉ phẳng, soft-delete), `OrderItem`, `Refund` (chỉ cho hoàn hàng). Bảng `outbox`/`processed_messages` thuộc `libs/messaging`.
- **Commands**: `Checkout`, `PreparePayment` (chốt #2), `CancelOrder`, `RequestReturn`, `ExpirePendingOrders`, `CompleteDeliveredOrders`, `HandlePaymentEvent`, `HandleInventoryEvent`, `HandleShippingEvent`. **Queries**: `GetOrder`, `GetOrders`, `GetRefunds`.
- **Module con**: `cart/` (Redis, `deductItems`), `clients/` (Inventory/Payment/Product/Promotion TCP), `pricing/` (`OrderPricingService`, `money.ts`), `order-state/` (`OrderTransitionService`, `OrderCancellationService`, `OrderVersionConflictError`), `messaging/` (3 consumer Kafka), `jobs/` (`OrderLifecycleScheduler`: 30s hết hạn, 10 phút auto COMPLETED).
- **State machine** (`order-status.constant.ts`): PENDING_PAYMENT → PAID → FULFILLING → SHIPPED → DELIVERED → COMPLETED; huỷ từ PENDING_PAYMENT/PAID/FULFILLING; DELIVERED → REFUNDING → REFUNDED. Mọi đổi trạng thái qua `OrderTransitionService` (`UPDATE ... WHERE version` + outbox cùng TX).
- **TCP Patterns**: CHECKOUT, GET_PAYMENT_LINK, CANCEL_ORDER, REQUEST_RETURN, GET_ORDER, GET_ORDERS, GET_REFUNDS, cart (`CART_MESSAGE_PATTERN`).
- **Đã xoá ở cutover**: `saga/`, `CreateOrderHandler`, `ConfirmOrderPaymentHandler`, `PaymentEventsController` TCP, `UpdateOrderStatusHandler`, Create/Approve/RejectRefund, `OrderCreatedHandler`/event cũ, `OutboxWorker`.
- **Gaps**: `GET_ORDERS`/`GET_ORDER` không kiểm tra chủ sở hữu; xem [design-trade-offs.md §2.1](./design-trade-offs.md).

### 5. Payment Service (`apps/payment/`)
**Mục đích**: payment intent, webhook HMAC, hoàn tiền, simulator. **Kiến trúc**: CQRS + Outbox/Inbox. Hybrid TCP :3004 + Kafka group `payment-service`.

- **Entities**: `PaymentTransaction` (= intent: `PENDING|SUCCEEDED|FAILED|CANCELLED`, `expiresAt`, `checkoutUrl`, `paidAt`), `PaymentWebhookLog` (dedup `eventId`), `PaymentRefund` (unique `orderId`).
- **Commands**: `CreatePaymentIntent`, `HandlePaymentWebhook`, `SimulatePayment`, `CancelPaymentIntent`, `RefundPayment`, `HandlePaymentCommandMessage`. **Queries**: `GetTransaction`, `GetPaymentIntent`.
- **Providers**: `PaymentProvider` (`createIntent`, `refund`, `signWebhook`, `verifyWebhook`) + `SimulatedPaymentProvider` (DI token `PAYMENT_PROVIDER`); `PaymentAutoSimulatorService` (`PAYMENT_SIM_MODE`).
- **Kafka**: consume `payment-commands` (`CancelPaymentIntent`, `RefundPayment`); produce `payment-events` qua outbox.
- **TCP**: CREATE_INTENT, HANDLE_WEBHOOK, GET_INTENT, SIMULATE_PAYMENT, GET_TRANSACTION. **Đã xoá**: `CHARGE_PAYMENT`, `ChargePaymentHandler`, client TCP ngược về Orders.

### 6. Notification Service (`apps/notification/`)
**Mục đích**: email theo event Orders. **Kiến trúc**: plain (không CQRS). Hybrid TCP :3005 + Kafka consumer group `notification-service`.

- **Entity**: `SentNotification` (channel EMAIL/PUSH, status SENT/FAILED, sourceEvent).
- **Consumer**: `OrderEventsController` (`@EventPattern('order-events', Transport.KAFKA)` → `KafkaConsumerRunner`: inbox, retry 3, DLQ). `OrderCreated`/`OrderStatusChanged` gửi email; type khác chỉ đánh dấu inbox.
- **Providers**: `EmailProvider`/`SimulatedEmailProvider` (log); `PushProvider` đã đăng ký DI nhưng chưa handler nào gọi.

### 7. Review Service (`apps/review/`)
**Mục đích**: đánh giá có verify đã mua. **Kiến trúc**: Full CQRS.

- **Entity**: `Review` (unique `[userId, productId, orderId]`, rating, comment).
- **Commands/Queries**: `CreateReview`; `GetReviewsByProduct`. Verify qua Orders TCP `GET_ORDER`: đúng chủ, `status ∈ {PAID,FULFILLING,SHIPPED,DELIVERED,COMPLETED}`, chứa `productId`.

### 8. Promotion Service (`apps/promotion/`)
**Mục đích**: voucher; nối checkout. **Kiến trúc**: Full CQRS. Hybrid TCP :3007 + Kafka consumer group `promotion-service`.

- **Entities**: `Voucher`, `VoucherRedemption` (`RESERVED|CONFIRMED|RELEASED`, unique `orderId`).
- **TCP**: CREATE_VOUCHER, GET_VOUCHERS, GET_AVAILABLE_VOUCHERS, APPLY_VOUCHER (cũ), VALIDATE_VOUCHER, RESERVE_VOUCHER, RELEASE_VOUCHER. **Kafka** `order-events`: `OrderPaid` → CONFIRMED; `OrderCancelled{paid:false}` → release.
- Quy tắc kiểm tra/công thức ở `domain/voucher-rules.ts` (hàm thuần); khoá voucher → redemption (pessimistic).

### 9. Inventory Service (`apps/inventory/`)
**Mục đích**: sở hữu tồn kho và giữ hàng. **Kiến trúc**: Full CQRS + Outbox/Inbox. Hybrid TCP :3008 + Kafka group `inventory-service`.

- **Entities**: `StockItem` (`onHand`, `reserved`, `variantId?`), `Reservation` (`RESERVED|COMMITTED|RELEASED|EXPIRED|RESTOCKED`, `expiresAt`).
- **Commands**: `ReserveStock`, `ReleaseReservation`, `AdjustStock`, `ExpireReservations`, `HandleInventoryCommandMessage`. **Queries**: `CheckReservation`, `GetAvailability`. `ReservationService` (nhận `EntityManager`) có `commit`/`restock`.
- **Kafka**: consume `inventory-commands` (`CommitInventory`, `ReleaseInventory`, `RestockInventory`); phát `InventoryCommitted`/`InventoryCommitFailed`. Job hết hạn `ReservationExpiryJob`.
- **TCP**: RESERVE, CHECK_RESERVATION, RELEASE, ADJUST_STOCK, GET_AVAILABILITY.

### 10. Shipping Service (`apps/shipping/`)
**Mục đích**: vận đơn với carrier mô phỏng, webhook giao hàng. **Kiến trúc**: Full CQRS + Outbox/Inbox. Hybrid TCP :3009 + Kafka group `shipping-service`.

- **Entity**: `Shipment` (`CREATED|DELIVERED|CANCELLED|FAILED`, `trackingCode`, `orderId` unique).
- **Kafka**: consume `shipping-commands` (`CreateShipment` retry 3 → DLQ → `ShipmentFailed`; `CancelShipment`); phát `ShipmentCreated`/`ShipmentDelivered`/`ShipmentFailed`.
- **TCP**: HANDLE_WEBHOOK (HMAC `SHIPPING_WEBHOOK_SECRET`), SIMULATE_DELIVERY, GET_SHIPMENT. `DeliveryTimerService` (`SHIPPING_SIM_DELIVER_DELAY_MS`); `SHIPPING_PROVIDER` = `SimulatedShippingProvider`.

---

## Shared Libraries (Libs)

### `libs/common/`
- **Exception Handling**: `AbstractRpcExceptionFilter` (HttpException/TypeORM/class-validator → RpcException); subclass theo service.
- **Configuration**: `CommonConfigModule` (ConfigModule global + `validateEnv`). **Bắt buộc**: `DB_*`, `REDIS_HOST/PORT`, `JWT_ACCESS_*`, `JWT_REFRESH_*`, `API_KEY`, `KAFKA_BROKERS`, `PAYMENT_WEBHOOK_SECRET`, `SHIPPING_WEBHOOK_SECRET`. **Tuỳ chọn** (validate): `KAFKA_TOPIC_PARTITIONS`, `KAFKA_CONSUMER_MAX_ATTEMPTS`, `KAFKA_CONSUMER_RETRY_BACKOFF_MS`, `OUTBOX_RELAY_INTERVAL_MS`, `OUTBOX_MAX_RETRY`, `INVENTORY_EXPIRY_GRACE_SECONDS`, `PAYMENT_SIM_MODE`, `PAYMENT_SIM_DELAY_MS`, `PUBLIC_API_BASE_URL`, `ORDER_PAYMENT_TTL_SECONDS`, `ORDER_RETURN_WINDOW_DAYS`, `SHIPPING_SIM_MODE`, `SHIPPING_SIM_DELIVER_DELAY_MS`, `NODE_ENV`. Đọc trực tiếp qua `ConfigService` (không validate): `ORDER_TAX_RATE`, `ORDER_SHIPPING_FEE_FLAT`, `CART_TTL_SECONDS`, `CORS_ORIGINS`, `THROTTLE_*`, `DB_POOL_*`.
- **Utilities**: `PaginationQueryDto`/`PaginatedResult<T>`, `setupTracing()` (mỗi app một metrics port).
- **Note**: `src/constant/cmd.ts` là bản trùng/cũ của `libs/constant/message-pattern.constant.ts` (dead code).

### `libs/database/`
- `DatabaseModule`: `autoLoadEntities`, `synchronize:false`, `migrationsRun:true`, pool max 50/min 5 (`DB_POOL_MAX/MIN`).
- **Migrations** (`src/migrations/`): bộ cũ tới `AddUserAvatarUrl` (1790335853906), sau đó theo thứ tự: `AddProductsCreatedAtIndex`, `AddKafkaOutboxAndInbox`, `AddOrderLifecycleColumns`, `AddInventoryTables`, `AddPaymentIntentAndRefund`, `AddShipments`, `AddVoucherRedemptions`, `FinalizeOrderStatusAndStockOwnership` (chốt enum order status, bỏ cột `stock`, bỏ default outbox). Mọi migration mới idempotent, có `down`.
- **DataSource**: TypeORM CLI (`src/data-source.ts`); `loadtest/migrate.js` dựng DB trống bằng `schema:sync` + fake migration cũ.

### `libs/cached/`
`CachedModule` (@Global, ioredis), `CachedService` (`get/set(ttl)/del`; chưa có `SET NX`), `RedisHealthIndicator`. Dùng cho cart, refresh token, throttle, idempotency.

### `libs/media/`
`MediaModule` (@Global), `MediaService` (`uploadFile`, `getPresignedUrl`), bucket `ecommerce-media` tự tạo; ảnh product, avatar.

### `libs/messaging/` (`@lib/messaging`)
- `MessagingModule.forService({source, relay?})`; `OutboxWriter.append(manager, {topic, type, orderId, payload})`; `OutboxRelayService` (`SKIP LOCKED`, ack broker mới `PUBLISHED`); `InboxService` (`processed_messages`); `KafkaConsumerRunner.run` (inbox + TX + retry + DLQ + `afterCommit` + `onExhausted`); `KafkaProducerService`; `ensureKafkaTopics`; envelope; entities `OutboxMessage`, `ProcessedMessage`. Int-spec: `libs/messaging/test/*.int-spec.ts`.

### `libs/constant/`
Flat files (không phải lib project trong nest-cli).
- **`port-tcp.constant.ts`** (`PORT_TCP`, `NAME_SERVICE_TCP`): USER 3001, ORDER 3002, PRODUCT 3003, PAYMENT 3004, NOTIFICATION 3005, REVIEW 3006, PROMOTION 3007, INVENTORY 3008, SHIPPING 3009.
- **`message-pattern.constant.ts`**: `*_MESSAGE_PATTERN` theo domain (giá trị snake_case không dấu chấm), gồm `INVENTORY_`, `SHIPPING_`, `PROMOTION_` (VALIDATE/RESERVE/RELEASE). Đã bỏ `PRODUCT.ADJUST_STOCK`, `ORDER.CREATE_ORDER|UPDATE_ORDER_STATUS|CREATE_REFUND|APPROVE_REFUND|REJECT_REFUND`, `PAYMENT.CHARGE_PAYMENT`, `PAYMENT_EVENT_PATTERN`.
- **`kafka.constant.ts`**: `KAFKA_TOPIC`, `dlqTopic`, `MESSAGE_TYPE`, `CONSUMER_GROUP`, `OUTBOX_SOURCE`.
- **`permission.constant.ts`**: `Action` (CREATE=1, READ=2, UPDATE=4, DELETE=8, ALL=15), `ModuleName` (USER=16, PRODUCT=32, ORDER=64, CAMPAIGN=128, PAYMENT=256, REVIEW=512, PROMOTION=1024); check `(userPermissions & required) === required` ([code-standards.md](./code-standards.md#permission-model)).

---

## Infrastructure & External Services

### Docker Compose (`docker-compose.yml`)
- **PostgreSQL 15** :5432 · **Redis** :6379 · **Kafka** (`apache/kafka:3.8.0`, KRaft 1 broker; listener `kafka:29092` nội bộ, `localhost:9092` cho host; tắt auto-create topic) · **Jaeger** 16686/4317/4318 · **Prometheus** 9090 · **Grafana** 3100 · **MinIO** 9000/9001 (image `cgr.dev/chainguard/minio`).
- `npm run docker:up` khởi động toàn bộ; `npm run start:all` chạy 10 app (`concurrently`).

### NestJS App Ports
Gateway :3000 (HTTP) · User 3001 · Orders 3002 · Product 3003 · Payment 3004 · Notification 3005 · Review 3006 · Promotion 3007 · Inventory 3008 · Shipping 3009 (TCP).

### Metrics Ports (OpenTelemetry Prometheus)
Gateway 9464 · User 9465 · Product 9466 · Orders 9467 · Payment 9468 · Notification 9469 · Review 9470 · Promotion 9471 · Inventory 9472 · Shipping 9473 (`prometheus.yml` chưa có target inventory/shipping).

---

## Technology Stack Summary

| Layer | Technology |
|-------|-----------|
| **Framework** | NestJS v11, TypeScript |
| **Database** | PostgreSQL 15 + TypeORM |
| **Cache/Session** | Redis 7 + ioredis |
| **Messaging** | Apache Kafka (`kafkajs`, `@nestjs/microservices`) cho event/command; TCP cho RPC |
| **File Storage** | MinIO (S3-compatible) |
| **Auth** | JWT (15m access, 7d refresh), bcrypt |
| **Design Pattern** | CQRS (@nestjs/cqrs); Orchestration; Transactional Outbox + Inbox; optimistic (`version`) / pessimistic locking; circuit breaker (opossum) |
| **Validation** | class-validator + global ValidationPipe |
| **Observability** | OpenTelemetry (Jaeger), Prometheus, Grafana |
| **API Documentation** | Swagger at /api/docs |
| **Security** | Helmet, CORS, HMAC-SHA256 (webhook), API key, Throttler + Redis, bitmask RBAC |
| **Test** | Jest unit (`npm test`, mock); int-spec `npm run test:int` (Postgres; Kafka khi `INT_KAFKA=1`); k6 load test |

---

## Known Gaps & Roadmap Items

1. **Chưa kiểm chứng trên stack thật**: toàn bộ migration mới, int-spec, seed, load test, e2e checkout (xem [target-checkout-architecture.md §10](./target-checkout-architecture.md)).
2. **Product**: chưa cache Redis cho catalog; `ProductCreatedEvent` là stub.
3. **Payment/Shipping**: chỉ simulator; cổng/carrier thật chưa làm (cần ký raw body).
4. **Notification**: `PushProvider` chưa được gọi.
5. **Dependencies**: `amqp-connection-manager`/`amqplib` còn trong package.json nhưng RabbitMQ không dùng.
6. **Ownership**: `GET /orders*`, `GET /orders/:id/refunds`, addresses không kiểm tra chủ sở hữu.
7. **Voucher**: crash giữa `RESERVE_VOUCHER` và TX tạo đơn làm kẹt lượt; `/vouchers/apply` cũ tiêu lượt không gắn đơn.
8. **Idempotency Gateway**: get-then-set không nguyên tử (thiếu `SET NX`).
9. **Refund**: `FAILED` không retry được; hoàn hàng gặp `PaymentRefundFailed` kẹt `REFUNDING`.
10. **Env**: không có `.env.example` (README liệt kê biến bắt buộc).
11. **Auth**: chưa có endpoint refresh token; `gateway.controller.spec.ts` boilerplate đang fail.

---

## How to Navigate This Codebase

1. **Startup**: `apps/gateway/src/main.ts` (HTTP), rồi một service hybrid (`apps/orders/src/main.ts`: TCP + Kafka + `ensureKafkaTopics`).
2. **CQRS**: `apps/product/src/commands/` (CRUD đơn giản), rồi `apps/orders/src/commands/handlers/checkout.handler.ts` (orchestration).
3. **Data flow checkout**: Gateway `cart.controller.ts` → Orders `CheckoutHandler` → Inventory `RESERVE` (TCP) → Order `PENDING_PAYMENT` + outbox → Payment `CREATE_INTENT` → simulator webhook → `payment-events` → `HandlePaymentEventHandler` → `inventory-commands` → `shipping-commands` → `shipping-events` (đọc [system-architecture-orders-flow.md](./system-architecture-orders-flow.md)).
4. **Messaging**: `libs/messaging/src/consumer/kafka-consumer.runner.ts`, `outbox/outbox-relay.service.ts`.
5. **Observability**: `setupTracing()` trong `main.ts`, Jaeger tại http://localhost:16686.
6. **Database schema**: [database-schema.md](./database-schema.md); migration trong `libs/database/src/migrations/`.
