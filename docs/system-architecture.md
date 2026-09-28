# System Architecture

**Ngày cập nhật**: 2026-09-28

Tài liệu này mô tả kiến trúc tổng thể của hệ thống: các thành phần, giao tiếp giữa services, và observability stack. Các flow nghiệp vụ chi tiết (checkout saga, outbox pattern, auth flow, gateway request flow) được tách riêng theo từng feature — xem mục **Tài liệu liên quan** ở cuối file.

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
                          │   (HTTP REST Entry Point)    │
                          │                              │
                          │ • Auth (JWT validation)      │
                          │ • Rate limiting (Redis)      │
                          │ • Idempotency (Redis)        │
                          │ • Request logging            │
                          │ • CORS + Helmet + API key    │
                          └──────────┬───────────────────┘
                                     │ TCP Transport (point-to-point)
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
        ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
        │  USER SERVICE   │  │ORDER SERVICE │  │PRODUCT       │
        │    (:3001)      │  │  (:3002)     │  │SERVICE       │
        │                 │  │              │  │(:3003)       │
        │ • Auth          │  │ • Cart       │  │              │
        │ • Users         │  │ • Saga       │  │ • Catalog    │
        │ • Roles         │  │ • Inventory  │  │ • Inventory  │
        │ • Addresses     │  │ • Outbox     │  │ • Variants   │
        │ • Permissions   │  │   Pattern    │  │              │
        └─────────────────┘  └──────────────┘  └──────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
        ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
        │PAYMENT SERVICE  │  │NOTIFICATION  │  │REVIEW        │
        │    (:3004)      │  │SERVICE       │  │SERVICE       │
        │                 │  │(:3005)       │  │(:3006)       │
        │ • Charge pay    │  │              │  │              │
        │ • Webhook       │  │ • Email      │  │ • Reviews    │
        │ • Idempotency   │  │ • Push (WIP) │  │ • Ratings    │
        │                 │  │ • Events     │  │ • Purchase   │
        └─────────────────┘  └──────────────┘  │   verify     │
                                                 └──────────────┘
                    ┌────────────────┐
                    │                ▼
                    │  ┌──────────────────────┐
                    │  │ PROMOTION SERVICE    │
                    │  │ (:3007)              │
                    │  │                      │
                    │  │ • Vouchers           │
                    │  │ • Discounts          │
                    │  │ • Lock mechanisms    │
                    │  └──────────────────────┘
                    │
                    ▼
    ┌────────────────────────────────────────────────────────┐
    │         INFRASTRUCTURE (Docker Compose)                │
    ├────────────────────────────────────────────────────────┤
    │                                                        │
    │  ┌──────────────┐  ┌──────────┐  ┌──────────────┐    │
    │  │ PostgreSQL   │  │  Redis   │  │   MinIO      │    │
    │  │ (:5432)      │  │ (:6379)  │  │ (:9000/9001) │    │
    │  │              │  │          │  │              │    │
    │  │ • All data   │  │ • Cache  │  │ • Images     │    │
    │  │ • Outbox     │  │ • Tokens │  │ • Avatars    │    │
    │  │ • Migrations │  │ • Cart   │  │ • S3 API     │    │
    │  │              │  │ • Sessions│  │              │    │
    │  └──────────────┘  └──────────┘  └──────────────┘    │
    │                                                        │
    │  ┌──────────────┐  ┌──────────┐  ┌──────────────┐    │
    │  │  Jaeger      │  │Prometheus│  │  Grafana     │    │
    │  │ (:16686)     │  │ (:9090)  │  │ (:3005→3000) │    │
    │  │              │  │          │  │              │    │
    │  │ • Tracing    │  │ • Metrics│  │ • Dashboards │    │
    │  │ • OTLP       │  │ • Per-svc│  │ • Alerts     │    │
    │  │              │  │   port   │  │              │    │
    │  └──────────────┘  └──────────┘  └──────────────┘    │
    │                                                        │
    └────────────────────────────────────────────────────────┘
```

---

## Communication Patterns (Cách các service giao tiếp)

### 1. Gateway ↔ Microservices (TCP)
- **Transport**: NestJS `@nestjs/microservices` TCP transport
- **Chiều giao tiếp**: request-response (`.send()`) hoặc fire-and-forget (`.emit()`)
- **Xử lý lỗi**: RPC error được map sang HTTP status code qua `HttpExceptionFilter`
- **Timeout**: 10 giây/call qua `TcpResilienceService` (const `TIMEOUT_MS` trong `apps/gateway/src/common/tcp-resilience.service.ts`). Ngoại lệ: `JwtAuthGuard` gọi `VERIFY_TOKEN` trực tiếp (không qua service này) với timeout riêng 5 giây
- **Resilience**: Circuit breaker bằng Opossum (50% error threshold mở breaker, 15s half-open reset). Opossum's `timeout` option bị tắt — timeout thực tế do RxJS `timeout()` operator bên ngoài xử lý

```typescript
// Gateway gọi Order Service (request-response) — dùng object { cmd } + firstValueFrom
const order = await firstValueFrom(
  this.orderClient.send({ cmd: ORDER_MESSAGE_PATTERN.CREATE_ORDER }, createOrderDto),
);

// Gateway emit thông báo (fire-and-forget)
this.notificationClient.emit(ORDER_EVENT_TYPE.ORDER_CREATED, { orderId, userId });
```

### 2. Inter-Service Communication (giao tiếp giữa các microservice)
- **Loại**: Point-to-point TCP, **không dùng message broker** (RabbitMQ đã bị loại bỏ hoàn toàn)
- **Pattern**: Service này gọi trực tiếp service kia qua TCP
  - Ví dụ: Orders gọi Product để trừ/hoàn stock
  - Ví dụ: Review gọi Orders để verify đã mua hàng
- **Không có Event Bus dùng chung**: các service giao tiếp qua TCP `.send()`/`.emit()` thô, không qua CQRS EventBus (EventBus của `@nestjs/cqrs` chỉ dùng nội bộ trong 1 service)

```typescript
// Order service gọi Product service để trừ stock (delta âm) hoặc hoàn stock (delta dương)
// Chỉ có 1 message pattern ADJUST_STOCK — không có RPC riêng cho "reserve"/"release"
const result = await firstValueFrom(
  this.productClient.send(
    { cmd: PRODUCT_MESSAGE_PATTERN.ADJUST_STOCK },
    { productId, delta: -quantity },
  ),
);
```

### 3. Event Listener mẫu (Notification lắng nghe sự kiện Order)

```typescript
@Controller('order-events')
export class OrderEventsController {
  @EventPattern(ORDER_EVENT_TYPE.ORDER_CREATED) // 'order.created'
  async onOrderCreated(data: OrderCreatedEvent) {
    const user = await firstValueFrom(
      this.userClient.send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId: data.userId }),
    );
    await this.emailProvider.send(user.email, `Order ${data.orderId} created`);
  }
}
```

Chi tiết pattern Transactional Outbox (đảm bảo event không bị mất) → xem [system-architecture-orders-flow.md](./system-architecture-orders-flow.md).

---

## Key Architectural Patterns — tóm tắt

| Pattern | Dùng ở đâu | Mục đích | Chi tiết |
|---|---|---|---|
| Checkout Saga | Orders service | Điều phối reserve stock → tạo order → charge payment, có compensation khi fail | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| Transactional Outbox | Orders service | Đảm bảo event không mất khi service crash giữa chừng | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| Optimistic Locking | Product (`@VersionColumn`) | Tránh race condition khi nhiều request cùng trừ stock | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| Pessimistic Locking | Promotion (voucher) | Tránh 1 voucher bị dùng vượt `usageLimit` khi có concurrent request | [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) |
| CQRS | Orders, Product, Payment, Review, Promotion | Tách rõ write (Command) và read (Query) | [code-standards.md](./code-standards.md#cqrs-structure) |
| JWT Auth + Redis session | Gateway + User service | Xác thực stateless nhưng có thể revoke qua Redis | [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) |
| Gateway middleware chain | Gateway | Helmet → CORS → tracking (middleware) → **Guards (Jwt/Permission/Throttler) → Interceptors (Idempotency) → Pipes (Validation)** → Controller | [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) |

---

## Observability Stack

### OpenTelemetry Tracing (Jaeger)

```
Mỗi service trong main.ts gọi setupTracing():
├─ Khởi tạo OpenTelemetry SDK
├─ Kết nối Jaeger gRPC (localhost:4317)
├─ Auto-instrument NestJS, HTTP, DB, Redis calls
├─ Mỗi RPC call → tạo 1 span trong Jaeger
└─ Jaeger UI tại http://localhost:16686
   └─ Xem trace waterfall, service dependencies, latency
```

### Prometheus Metrics

```
Mỗi service expose endpoint /metrics:
├─ Port 9464 (gateway)
├─ Port 9469 (notification)
├─ Port 9470 (review)
├─ Port 9471 (promotion)
└─ Các service khác theo pattern 94XX

Metrics gồm:
├─ http_request_duration_seconds
├─ http_request_total
├─ nestjs_rpc_call_duration_seconds
├─ database_query_duration_seconds
└─ redis_operation_duration_seconds
```

### Grafana Dashboards

```
http://localhost:3005 (container grafana:3000)
Đăng nhập mặc định: admin/admin

Dashboard:
├─ Service Health (response time, error rate mỗi service)
├─ Request Tracing (phân tích latency theo span)
├─ Database Performance (query time, connection pool)
└─ Cache Performance (Redis hit rate, evictions)
```

### Health Checks

```
GET /health (Gateway + tất cả microservices)
Response:
{
  "status": "up",
  "checks": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "memory": { "status": "up" }
  },
  "info": {
    "uptime": 3600,
    "timestamp": "..."
  }
}

Dùng bởi:
├─ Container orchestrator (liveness/readiness probe)
├─ Load balancer (định tuyến traffic)
└─ Monitoring dashboard (hiển thị trạng thái)
```

---

## External Integrations & Planned Features

### Payment Provider
- **Hiện tại**: `SimulatedPaymentProvider` (luôn thành công, phục vụ test)
- **Kế hoạch**: vnpay/momo (scaffold đã có, chọn qua env `PAYMENT_PROVIDER`)
- **Trạng thái**: flow simulate chạy end-to-end, tích hợp provider thật chưa làm

### Email Notifications
- **Hiện tại**: `SimulatedEmailProvider` (chỉ log)
- **Kế hoạch**: Resend hoặc Brevo
- **Trạng thái**: event flow hoạt động, email chỉ log ra chứ chưa gửi thật

### Push Notifications
- **Hiện tại**: `SimulatedPushProvider` (đã đăng ký DI nhưng chưa controller nào gọi)
- **Kế hoạch**: Firebase Cloud Messaging (FCM)
- **Trạng thái**: chỉ scaffold, chưa hoạt động

### File Storage (MinIO)
- **Hiện tại**: MinIO S3-compatible storage (đã tích hợp đầy đủ)
- **Dùng cho**: ảnh sản phẩm, avatar user
- **Trạng thái**: hoạt động đầy đủ, tự tạo bucket khi khởi động

---

## Graceful Shutdown & Health Management

### Trình tự shutdown

```
Nhận SIGTERM (từ container orchestrator hoặc OS)
     ↓
1. Ngừng nhận request mới
   ├─ Microservices: dừng TCP server
   └─ Gateway: dừng HTTP server
     ↓
2. Chờ các request đang xử lý hoàn tất (mặc định timeout 30s)
   ├─ DB transaction commit/rollback
   ├─ Redis operation hoàn tất
   └─ Microservice RPC call resolve
     ↓
3. Đóng kết nối
   ├─ Đóng connection pool DB
   ├─ Đóng kết nối Redis
   ├─ Đóng MinIO client
   └─ Đóng TCP listener
     ↓
4. Thoát process (exit code 0 nếu sạch, khác 0 nếu timeout)
```

### Tích hợp Container Orchestrator

```yaml
# Docker health check
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 5s

# Kubernetes liveness/readiness probes
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 30

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## Dependencies & Dead Code

### Công nghệ đã deprecated

| Package | Trạng thái | Lý do |
|---------|--------|--------|
| amqp-connection-manager | Dead code | RabbitMQ đã bị loại bỏ hoàn toàn, thay bằng TCP |
| amqplib | Dead code | RabbitMQ đã bị loại bỏ hoàn toàn |

### Code cũ/trùng lặp

| Vị trí | Vấn đề | Hành động đề xuất |
|----------|-------|--------|
| `libs/common/src/constant/cmd.ts` | Trùng với `libs/constant/message-pattern.constant.ts` | Dùng file sau, xoá file này |

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

- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) — Checkout Saga, Transactional Outbox, Optimistic/Pessimistic Locking, ví dụ flow checkout đầy đủ
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) — Login, verify token, refresh token, logout
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) — Middleware chain của Gateway, request/response envelope
- [code-standards.md](./code-standards.md) — Quy ước code, CQRS structure
- [project-roadmap.md](./project-roadmap.md) — Trạng thái hiện tại, các gap đã biết
