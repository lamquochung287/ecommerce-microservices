# System Architecture

**Ngày cập nhật**: 2026-10-15

Tài liệu này mô tả kiến trúc tổng thể của hệ thống: các thành phần, giao tiếp giữa services, và observability stack. Các flow nghiệp vụ end-to-end xem [business-flows.md](./business-flows.md); xử lý chi tiết từng module xem [module-processing-flows.md](./module-processing-flows.md); đánh đổi thiết kế & rủi ro xem [design-trade-offs.md](./design-trade-offs.md). Thiết kế checkout v2 đã chốt: [target-checkout-architecture.md](./target-checkout-architecture.md) (đã implement; phần chưa kiểm chứng trên stack thật ghi ở §10). Các pattern riêng (orchestration/outbox, auth, gateway) tách theo từng file — xem **Tài liệu liên quan** ở cuối.

---

## Sơ đồ kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS (Browser/Mobile)                       │
└────────────────────────────────────────────┬────────────────────────────────┘
                                             │ HTTPS (JSON)
                                             ▼
                          ┌──────────────────────────────┐
                          │     API GATEWAY (:3000)      │
                          │ • Auth (JWT) + RBAC bitmask  │
                          │ • Rate limit / Idempotency   │
                          │   (Redis)                    │
                          │ • CORS + Helmet + API key    │
                          │ • Simulator /simulator/*     │
                          └──────────┬───────────────────┘
                                     │ TCP (RPC đồng bộ, point-to-point)
   ┌──────────┬──────────┬───────────┼────────────┬────────────┬────────────┬───────────┐
   ▼          ▼          ▼           ▼            ▼            ▼            ▼           ▼
┌───────┐ ┌────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐
│ USER  │ │PRODUCT │ │ ORDERS  │ │ PAYMENT │ │ INVENTORY │ │SHIPPING │ │PROMOTION │ │ REVIEW  │
│ :3001 │ │ :3003  │ │ :3002   │ │ :3004   │ │ :3008     │ │ :3009   │ │ :3007    │ │ :3006   │
│ Auth  │ │Catalog │ │Cart     │ │Intent   │ │stock_items│ │Shipment │ │Voucher   │ │Reviews  │
│Roles  │ │(không  │ │State    │ │Webhook  │ │reservation│ │Carrier  │ │Redemption│ │         │
│Address│ │ tồn kho│ │machine  │ │Refund   │ │expiry job │ │(sim)    │ │          │ │         │
│       │ │        │ │Scheduler│ │Simulator│ │           │ │Webhook  │ │          │ │         │
└───────┘ └────────┘ └────┬────┘ └────┬────┘ └─────┬─────┘ └────┬────┘ └────┬─────┘ └─────────┘
                          │  ┌───────┴────────────┴────────────┴───────────┘
                          ▼  ▼   Outbox → relay at-least-once → Inbox (chung bảng outbox / processed_messages)
        ┌──────────────────────────────────────────────────────────────────────────┐
        │  KAFKA (KRaft, :9092)  key = orderId                                      │
        │  order-events · payment-events · payment-commands · inventory-commands · │
        │  inventory-events · shipping-commands · shipping-events  (+ <topic>.dlq) │
        └───────────────────────────────┬──────────────────────────────────────────┘
                                        ▼
                         ┌──────────────────────────┐
                         │ NOTIFICATION (:3005)     │  consume order-events → email
                         └──────────────────────────┘

    ┌────────────────────────────────────────────────────────────────────────┐
    │  INFRASTRUCTURE (Docker Compose)                                       │
    │  PostgreSQL :5432 (1 DB, 1 bộ migration) · Redis :6379 (cart, session, │
    │  throttle, idempotency) · Kafka :9092 · MinIO :9000/9001               │
    │  Jaeger :16686 · Prometheus :9090 · Grafana :3100                      │
    └────────────────────────────────────────────────────────────────────────┘
```

Mỗi service ghi/đọc bảng của mình trên cùng một database; tham chiếu giữa domain bằng UUID (không FK chéo service). Orders, Payment, Inventory, Shipping, Promotion, Notification là app **hybrid** (TCP + Kafka); User, Product, Review, Gateway chỉ TCP/HTTP.

---

## Communication Patterns (Cách các service giao tiếp)

### 1. Gateway ↔ Microservices (TCP)
- **Transport**: NestJS `@nestjs/microservices` TCP transport
- **Chiều giao tiếp**: request-response (`.send()`)
- **Xử lý lỗi**: RPC error được map sang HTTP status code qua `HttpExceptionFilter`
- **Timeout**: 10 giây/call qua `TcpResilienceService` (`DEFAULT_TCP_TIMEOUT_MS`, tham số `timeoutMs` tuỳ chọn; catalog ghép tồn kho dùng 1500ms). Ngoại lệ: `JwtAuthGuard` gọi `VERIFY_TOKEN` trực tiếp (không qua service này) với timeout riêng 5 giây
- **Resilience**: Circuit breaker bằng Opossum (50% error threshold mở breaker, 15s half-open reset). Opossum's `timeout` option bị tắt — timeout thực tế do RxJS `timeout()` operator bên ngoài xử lý

```typescript
// Gateway chuyển checkout sang Orders (request-response) — userId lấy từ token
this.tcpResilience.send(NAME_SERVICE_TCP.ORDER_SERVICE, this.orderClient,
  { cmd: ORDER_MESSAGE_PATTERN.CHECKOUT }, { userId, dto });
```

### 2. Inter-Service Communication (giữa các microservice)
Hai kênh, chọn theo bản chất:

| Kênh | Dùng cho | Ví dụ |
|---|---|---|
| **TCP** `{cmd}` (đồng bộ, timeout 10s) | Cần trả lời ngay để quyết định bước kế tiếp | Orders → `Inventory.RESERVE` / `CHECK_RESERVATION`; Orders → `Payment.CREATE_INTENT`; Orders → `Promotion.VALIDATE/RESERVE_VOUCHER`; Orders → `Product.GET_PRODUCT`; Review → `Orders.GET_ORDER`; Notification → `User.GET_USER_INFO` |
| **Kafka** (bất đồng bộ, at-least-once) | Event/command điều phối sau điểm quyết định, cần chịu được consumer down | `OrderPaid`, `CommitInventory`, `CreateShipment`, `PaymentSucceeded`, `ShipmentDelivered`, `RefundPayment`... |

- Event/command Kafka **luôn** đi qua Outbox (`OutboxWriter.append(manager, ...)` cùng transaction với đổi state, key = `orderId`), không `emit` trực tiếp, không qua `EventBus` của `@nestjs/cqrs` (chỉ dùng nội bộ một service).
- Envelope chuẩn `{eventId, type, orderId, occurredAt, version, payload}`; command và event cùng envelope, phân biệt bằng `type` + topic.
- Consumer: `KafkaConsumerRunner` — 1 transaction gồm ghi Inbox (`processed_messages`, khử trùng theo `(consumer, eventId)`) + đổi state + ghi Outbox; lỗi → retry tối đa 3 lần → `<topic>.dlq` → service phát event thất bại tương ứng.
- Hybrid app bắt buộc gắn `Transport.TCP`/`Transport.KAFKA` cho từng `@MessagePattern`/`@EventPattern`.

### 3. Event Listener mẫu (Notification lắng nghe `order-events`)

```typescript
// apps/notification/src/order-events.controller.ts
@Controller()
export class OrderEventsController {
  @EventPattern(KAFKA_TOPIC.ORDER_EVENTS, Transport.KAFKA)
  async onOrderEvent(@Payload() message: unknown) {
    // KafkaConsumerRunner: inbox + transaction + retry 3 + DLQ;
    // OrderCreated/OrderStatusChanged → User.GET_USER_INFO → EmailProvider.send → ghi sent_notifications
  }
}
```

> Giao event là **at-least-once** (outbox chỉ `PUBLISHED` sau khi broker ack); consumer idempotent nhờ Inbox. Chi tiết: [system-architecture-orders-flow.md](./system-architecture-orders-flow.md), [design-trade-offs.md §2.4](./design-trade-offs.md#24-transactional-outbox--inbox-qua-kafka-at-least-once).

---

## Key Architectural Patterns — tóm tắt

| Pattern | Dùng ở đâu | Mục đích | Chi tiết |
|---|---|---|---|
| Orchestration (state machine + event/command) | Orders | Điều phối checkout → thanh toán → kho → vận chuyển → giao; Orders là bên duy nhất đổi trạng thái đơn | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md), [target-checkout-architecture.md](./target-checkout-architecture.md) |
| Transactional Outbox + Inbox (Kafka, at-least-once) | Orders, Payment, Inventory, Shipping | Event không mất khi crash/broker down; consumer khử trùng theo `eventId` | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| Optimistic Locking | Orders (`version`, `UPDATE ... WHERE version`) | Giải race giữa huỷ / event thanh toán / event giao hàng / scheduler | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| Reserve → commit/release | Inventory (`stock_items`, `reservations`) | Giữ hàng có TTL, chống oversell, tự thu hồi khi hết hạn | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| Pessimistic Locking | Promotion (voucher, `FOR UPDATE`), Inventory (`ORDER BY id FOR UPDATE`), Shipping (`CancelShipment`) | Tránh vượt `usageLimit`, deadlock khi reserve, đua huỷ/giao | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| CQRS | Orders, Product, Payment, Review, Promotion, Inventory, Shipping | Tách rõ write (Command) và read (Query); consumer Kafka → `CommandBus` | [code-standards.md](./code-standards.md#cqrs-structure) |
| JWT Auth + Redis session | Gateway + User service | Xác thực stateless nhưng có thể revoke qua Redis | [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) |
| Gateway middleware chain | Gateway | Helmet → CORS → tracking (middleware) → **Guards (Jwt/Permission/Throttler) → Interceptors (Idempotency) → Pipes (Validation)** → Controller | [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) |

---

## Observability Stack

### OpenTelemetry Tracing (Jaeger)

```
Mỗi service trong main.ts gọi setupTracing():
├─ Khởi tạo OpenTelemetry SDK
├─ Xuất trace tới Jaeger qua OTLP HTTP (localhost:4318/v1/traces)
├─ Auto-instrument NestJS, HTTP, DB, Redis calls
├─ Mỗi RPC call → tạo 1 span trong Jaeger
└─ Jaeger UI tại http://localhost:16686
   └─ Xem trace waterfall, service dependencies, latency
```

### Prometheus Metrics

```
Mỗi service expose /metrics (PrometheusExporter của OpenTelemetry) trên cổng riêng:
gateway 9464 · user 9465 · product 9466 · orders 9467 · payment 9468
notification 9469 · review 9470 · promotion 9471 · inventory 9472 · shipping 9473
(prometheus.yml có đủ 10 service, job `ecommerce-*`. Hạ tầng đi qua exporter, job `infra-*`: `postgres-exporter` :9187,
`redis-exporter` :9121, `kafka-exporter` :9308 — chạy trong network compose, không mở cổng ra host.)
Counter `outbox_failed_total{source}` đếm outbox row chuyển `FAILED`.

Metrics do auto-instrumentation + host-metrics sinh ra (HTTP, DB, Redis, process.*, system.*);
tên metric cụ thể phụ thuộc phiên bản @opentelemetry — kiểm tra tại /metrics thay vì dựa vào danh sách cố định.
```

### Grafana Dashboards

```
http://localhost:3100 (container grafana:3000)
Đăng nhập mặc định: admin/admin

Dashboard (grafana/dashboards/):
├─ Ecommerce - Server Overview   (RED theo service Node.js, CPU/RAM/event loop, host)
├─ Ecommerce - Infrastructure    (PostgreSQL, Redis, Kafka + pipeline nghiệp vụ đo từ DB)
└─ k6 Load Test                  (VUs, RPS, lỗi, p95)

Infrastructure gồm: Overview (up/down, consumer lag, DLQ, outbox PENDING/FAILED, đơn kẹt) · Pipeline nghiệp vụ
(đơn/giữ hàng/vận đơn theo trạng thái, tuổi event outbox cũ nhất, tồn kho) · PostgreSQL (kết nối, giao dịch, cache hit,
lock, deadlock, dead tuples, seq scan) · Redis (bộ nhớ, lệnh/s, hit ratio, evicted) · Kafka (lag theo group/topic,
msg/s theo topic, DLQ, replica).
```

Metric nghiệp vụ lấy bằng truy vấn SQL tuỳ biến `monitoring/postgres-queries.yaml` (postgres-exporter, cờ `--extend.query-path`
đã deprecated nhưng còn chạy ở v0.15.0): `outbox_messages_count`, `outbox_oldest_pending_age_seconds`, `orders_by_status_count`,
`orders_stuck_fulfillment_count`, `inventory_reservations_count`, `inventory_stock_totals_*`, `shipments_by_status_count`.
Các bảng chỉ có sau khi migration chạy; trước đó panel nghiệp vụ trống. Sau khi sửa `prometheus.yml` phải khởi động lại
container prometheus (file được mount, không tự reload). Dashboard Infrastructure: cú pháp PromQL (53 biểu thức) đã qua `promtool`; tên metric Kafka/Redis đã đối chiếu với exporter
chạy thật. Metric PostgreSQL và truy vấn tuỳ biến **chưa kiểm trên exporter chạy thật** (postgres-exporter đã có trong compose).

### Health Checks

```
GET /health (Gateway, dùng @nestjs/terminus)
├─ redis                 RedisHealthIndicator (ping)
├─ user-service          TCP health_check, timeout 5s
├─ product-service       TCP health_check, timeout 5s
└─ order-service         TCP health_check, timeout 5s

Mỗi microservice có health_check TCP riêng (HealthController, Terminus ping DB;
User thêm ping Redis). Payment, Notification, Review, Promotion, Inventory, Shipping
và Kafka chưa nằm trong /health của Gateway (xem gateway-flow §6).
```

---

## External Integrations & Planned Features

### Payment Provider
- **Hiện tại**: `SimulatedPaymentProvider` (token DI `PAYMENT_PROVIDER`, `useFactory`): `createIntent` trả `checkoutUrl` về `/simulator/pay/:intentId`, `refund` luôn thành công, webhook ký HMAC thật bằng `PAYMENT_WEBHOOK_SECRET`. Không gọi dịch vụ ngoài.
- **Kế hoạch**: vnpay/momo — implement `PaymentProvider` (`createIntent`, `refund`, `signWebhook`, `verifyWebhook`) và chọn provider theo env; ký trên raw body.
- **Trạng thái**: flow simulator đã chạy E2E trên stack thật: thanh toán thành công và thất bại, webhook trùng (E-07). E2E gọi `POST /simulator/pay/...` bằng HTTP, không mở trình duyệt.

### Shipping Carrier
- **Hiện tại**: `SimulatedShippingProvider` (token `SHIPPING_PROVIDER`): trả mã vận đơn ngẫu nhiên, giao hàng do timer (`SHIPPING_SIM_DELIVER_DELAY_MS`), admin (`POST /shipments/:orderId/deliver`) hoặc webhook HMAC (`SHIPPING_WEBHOOK_SECRET`) kích hoạt; `SHIPPING_SIM_MODE=fail` để thử retry/DLQ.

### Email Notifications
- **Hiện tại**: `SimulatedEmailProvider` (chỉ log)
- **Kế hoạch**: Resend hoặc Brevo
- **Trạng thái**: event flow hoạt động, email chỉ log ra chứ chưa gửi thật

### Push Notifications
- **Hiện tại**: `SimulatedPushProvider` (đã đăng ký DI nhưng chưa handler nào gọi)
- **Kế hoạch**: Firebase Cloud Messaging (FCM)
- **Trạng thái**: chỉ scaffold, chưa hoạt động

### File Storage (MinIO)
- **Hiện tại**: MinIO S3-compatible storage (đã tích hợp đầy đủ)
- **Dùng cho**: ảnh sản phẩm, avatar user
- **Trạng thái**: hoạt động đầy đủ, tự tạo bucket khi khởi động

---

## Graceful Shutdown & Health Management

### Shutdown

Mọi service gọi `app.enableShutdownHooks()` trong `main.ts`. Khi nhận SIGTERM, Nest đóng server (HTTP hoặc microservice, kể cả Kafka consumer) và chạy các hook `onModuleDestroy`. Outbox relay tự dừng timer trong `onModuleDestroy`.

- Code **không** cấu hình timeout chờ 30 giây hay cơ chế drain request riêng. Hành vi khi request đang chạy dở (vd transaction đang mở) chưa được kiểm chứng.

### Tích hợp Container Orchestrator

`docker-compose.yml` hiện **không khai báo healthcheck** cho service nào. Gateway có `GET /health` (mục trên) nếu cần probe khi triển khai, ví dụ `curl -f http://localhost:3000/health`. Chưa có cấu hình Kubernetes trong repo.

---

## Dependencies & Dead Code

### Công nghệ đã deprecated

| Package | Trạng thái | Lý do |
|---------|--------|--------|
| amqp-connection-manager | Còn trong `package.json`, không có import nào | RabbitMQ không dùng (kênh bất đồng bộ là Kafka qua `kafkajs`). Gỡ khỏi `package.json` |
| amqplib | Còn trong `package.json`, không có import nào | Như trên |

### Code cũ/trùng lặp

| Vị trí | Vấn đề | Hành động đề xuất |
|----------|-------|--------|
| `libs/common/src/constant/cmd.ts` | Vẫn được `apps/user/src/user.controller.ts` và `apps/notification/src/order-events.controller.ts` dùng (`CMD.GET_USER_INFO`), trùng giá trị với `USER_MESSAGE_PATTERN.GET_USER_INFO` | Chuyển hai nơi sang `libs/constant/message-pattern.constant.ts`, rồi xoá file |

---

## Next Steps (Phase 3+)

1. **Production Hardening**: hoàn thiện observability, security audit
2. **Real Payment Provider**: tích hợp vnpay/momo
3. **Real Email/Push**: tích hợp Resend/FCM
4. **Search Engine**: tích hợp Elasticsearch/OpenSearch
5. **Admin Back-office**: dashboard quản trị
6. **Performance Optimization**: cache Product, tối ưu query
7. **Deployment**: containerize, CI/CD, monitoring production

---

## Tài liệu liên quan

- [business-flows.md](./business-flows.md) — Luồng nghiệp vụ end-to-end, state machine đơn hàng, business rules
- [module-processing-flows.md](./module-processing-flows.md) — Xử lý chi tiết từng module (Gateway, User, Product, Orders, Payment, Notification, Review, Promotion, Inventory, Shipping) và cơ chế Kafka
- [design-trade-offs.md](./design-trade-offs.md) — Quyết định thiết kế, trade-off, rủi ro đã xác minh
- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) — Orchestration checkout v2, Outbox/Inbox Kafka, Optimistic/Pessimistic Locking, ví dụ flow đầy đủ
- [target-checkout-architecture.md](./target-checkout-architecture.md) — Thiết kế đã chốt + trạng thái triển khai (§10)
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) — Login, verify token, refresh token, logout
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) — Middleware chain của Gateway, request/response envelope
- [code-standards.md](./code-standards.md) — Quy ước code, CQRS structure
- [project-roadmap.md](./project-roadmap.md) — Trạng thái hiện tại, các gap đã biết
