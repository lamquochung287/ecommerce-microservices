# System Architecture — API Gateway Flow

**Ngày cập nhật**: 2026-10-15

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả pipeline mà mỗi HTTP request đi qua tại Gateway (`apps/gateway/src`), các route và quy tắc bắt buộc theo code hiện tại, và định dạng response envelope.

---

## 1. Thứ tự xử lý một request

Nest chạy theo thứ tự: **Middleware → Guards → Interceptors (trước handler) → Pipes → Handler → Interceptors (sau handler) → Exception Filters**. Guard luôn chạy trước interceptor và pipe.

```
HTTP Request
  │
  ├─ [app.use trong main.ts] helmet() → compression() → enableCors(CORS_ORIGINS, credentials)
  │
  ├─ [Middleware] RequestTrackerMiddleware (áp cho '*', trừ API_KEY_EXEMPT_ROUTES)
  │     ├─ x-request-id: dùng header nếu có, không có thì sinh UUID; echo lại trong response
  │     ├─ x-idempotency-key: chỉ lưu vào request và echo lại, CHƯA kiểm tra định dạng ở đây
  │     └─ x-api-key != API_KEY → 401 "API key is missing or invalid"
  │
  ├─ [Guard toàn cục] ThrottlerGuard (APP_GUARD)
  │     ├─ default: 100 request/phút/IP (THROTTLE_LIMIT_DEFAULT), lưu Redis
  │     └─ auth: POST /user/login, POST /user/register: 5/phút/IP (THROTTLE_LOGIN_LIMIT)
  │
  ├─ [Guard theo route] JwtAuthGuard (chỉ route có @UseGuards)
  │     ├─ thiếu Bearer token → 401
  │     ├─ gọi User.VERIFY_TOKEN qua TCP, timeout 5 giây, KHÔNG qua TcpResilienceService
  │     ├─ timeout → 504 "User service timeout"; User từ chối → 401
  │     └─ gắn req.user = { userId, email, fullName, permissions, ... }
  │
  ├─ [Guard theo route] PermissionGuard (khi có @RequirePermission)
  │     ├─ không có req.user → 403
  │     └─ (permissions & required) !== required → 403
  │
  ├─ [Interceptor toàn cục] IdempotencyInterceptor (xem §3)
  ├─ [Interceptor toàn cục] TransformInterceptor (bọc response, xem §4)
  │
  ├─ [Pipe toàn cục] ValidationPipe { whitelist, forbidNonWhitelisted, transform }
  │     └─ field lạ hoặc sai kiểu → 400
  │
  ├─ Controller → Service → TcpResilienceService.send(serviceKey, client, {cmd}, payload, timeoutMs)
  │
  └─ [Filter toàn cục] HttpExceptionFilter: mọi lỗi → envelope lỗi (xem §4)
```

Ghi chú:
- `JwtAuthGuard` **không** kiểm tra chữ ký tại Gateway. Việc verify (chữ ký, session trong Redis, user `isActive`, tính permissions) nằm ở User service. Xem [system-architecture-auth-flow.md](./system-architecture-auth-flow.md).
- `ThrottlerGuard` là guard toàn cục (`APP_GUARD`), nên chạy trước guard theo route.

---

## 2. Miễn x-api-key và các route đặc biệt

| Route | x-api-key | JWT | Ghi chú |
|---|---|---|---|
| `GET /health` | Miễn | Không | Health tổng hợp (xem §6) |
| `/simulator/pay/*path` (GET trang, POST kết quả) | Miễn | Không | Trình duyệt không gửi được header. Controller trả 404 khi `NODE_ENV=production` |
| `POST /webhooks/payments`, `POST /webhooks/shipping` | **Bắt buộc** | Không | Không JWT. Chữ ký HMAC do Payment/Shipping kiểm |
| Mọi route còn lại | **Bắt buộc** | Tuỳ route | |

`API_KEY_EXEMPT_ROUTES` nằm trong `request-tracker.middleware.ts`. Trình duyệt mở `/simulator` không gửi được header, nên được miễn; kết quả thanh toán vẫn đi qua webhook có HMAC.

---

## 3. IdempotencyInterceptor

Áp cho method ghi (khác `GET`, `OPTIONS`, `HEAD`, `TRACE`). Chỉ bắt buộc ở route gắn `@RequireIdempotencyKey()`, hiện chỉ có **`POST /cart/checkout`**.

| Tình huống | Kết quả |
|---|---|
| Route bắt buộc, thiếu header | **400** "Thiếu header x-idempotency-key" |
| Key không khớp `^[A-Za-z0-9._:-]{1,128}$` | **400** |
| Redis lỗi, route bắt buộc | **503** "Không kiểm tra được idempotency, vui lòng thử lại" (không gọi Orders) |
| Redis lỗi, route thường | Chạy tiếp, mất bảo đảm chống trùng (fail-open) |
| Key đã có, trạng thái `processing` | **409** "Request is already being processed." |
| Key đã có, trạng thái `resolved` | Trả lại response đã lưu với **đúng status gốc** (ví dụ 201), không gọi handler |
| Key mới | Đặt `processing` (TTL 120 giây), chạy handler; thành công thì lưu `resolved` (TTL 24 giờ) rồi mới trả; lỗi thì **xoá key** để client thử lại |

- Redis key: `idempotency:{userId | anon}:{METHOD}:{path thực}:{key}`. Cùng key của hai user hoặc hai route không đụng nhau.
- Còn hở: thao tác get-rồi-set không nguyên tử (`CachedService` chưa có `SET NX`). Hai request đồng thời cùng key có thể cùng lọt. Orders vẫn chống trùng nhờ `replaces` khi checkout.

---

## 4. Response envelope

Thành công (`TransformInterceptor`):
```jsonc
{
  "success": true,
  "data": { /* dữ liệu */ },
  "error": null,
  "message": "Success",
  "meta": {
    "statusCode": 201,
    "timestamp": "2026-10-15T10:30:00.000Z",
    "path": "/cart/checkout",
    "method": "POST",
    "requestId": "uuid"
  }
}
```
- Nếu service trả object có cả `data` và `meta` (phân trang), `data` được bóc ra và `meta` được gộp vào `meta` của envelope.

Lỗi (`HttpExceptionFilter`):
```jsonc
{
  "success": false,
  "data": null,
  "error": "BadRequestException",   // tên lớp/kiểu lỗi, là chuỗi
  "message": "Thiếu header x-idempotency-key",
  "meta": {
    "statusCode": 400,
    "timestamp": "2026-10-15T10:30:00.000Z",
    "path": "/cart/checkout",
    "method": "POST",
    "requestId": "uuid"
  }
}
```
- `error` là chuỗi tên lỗi, không phải object.
- Lỗi từ microservice được `MicroserviceErrorHandler` đổi thành HTTP status (theo `statusCode` của `RpcException`), rồi `HttpExceptionFilter` đóng gói.
- `apps/gateway/src/common/interceptor/response.interceptor.ts` **không được đăng ký** ở `GatewayModule`. Chỉ `TransformInterceptor` có hiệu lực.

---

## 5. TcpResilienceService (Gateway → service)

`apps/gateway/src/common/tcp-resilience.service.ts`:
- Một circuit breaker (opossum) cho mỗi `serviceKey`.
- `timeout: false` trong breaker; timeout do RxJS `timeout(timeoutMs)` xử lý. Mặc định `DEFAULT_TCP_TIMEOUT_MS = 10000`.
- Mở khi >50% lỗi trong cửa sổ 10 giây; half-open sau 15 giây.
- **Lỗi 4xx từ service không được tính là lỗi hạ tầng** (`errorFilter: isClientError`): 400 chữ ký sai, 404, 409... không làm mở breaker. Lỗi 5xx và timeout vẫn tính.
- Breaker đang mở → fail-fast, trả 502 "Breaker is open".
- Catalog ghép tồn kho dùng `timeoutMs = 1500` (`INVENTORY_LOOKUP_TIMEOUT_MS`). Lỗi hoặc timeout trả `UNKNOWN`, không làm lỗi danh sách.

---

## 6. Health

`GET /health` (`apps/gateway/src/health/health.controller.ts`, `@nestjs/terminus`) kiểm tra:
- Redis (`RedisHealthIndicator`)
- `user-service`, `product-service`, `order-service` (gửi `health_check` qua TCP, timeout 5 giây)

Payment, Notification, Review, Promotion, Inventory, Shipping và Kafka **không** nằm trong `/health` của Gateway. Mỗi microservice có health check riêng (`cmd: health_check`).

---

## 7. Bảng route

Quyền ghi theo `Module|Action` (`@RequirePermission`). Mọi controller có `JwtAuthGuard` ở class level trừ khi ghi chú khác.

| Nhóm | Route | Guard / quyền | Đi tới |
|---|---|---|---|
| User | `POST /user/register`, `POST /user/login` | Không JWT; throttle 5/phút | User `REGISTER_USER`, `LOGIN_USER` |
| User | `POST /user/logout` | **Không guard**, nhận `{userId, sessionId}` từ body | User `LOGOUT_USER` |
| User | `GET /user/profile/:userId` | JWT | Stub (trả `undefined`) |
| User | `POST /user/me/avatar` | JWT, `userId` từ token | User `UPDATE_AVATAR` + MinIO |
| Roles | `/roles/*` | JWT + `USER` (CREATE/READ/UPDATE/DELETE) | User `ROLE_*` |
| Addresses | `/addresses/*` | JWT only (không PermissionGuard) | User `ADDRESS_*`; `:id` chưa kiểm chủ sở hữu |
| Product | `GET /products`, `GET /products/:id` | `PRODUCT|READ` | Product + ghép `available`, `stockStatus` từ Inventory |
| Product | `POST /products` (CREATE); `PUT /products/:id`, `POST /products/:id/images`, `POST /products/:id/stock-adjustments` (UPDATE); `DELETE /products/:id` (DELETE); `GET /products/:id/variants` (READ) | `PRODUCT|...` | Product; stock-adjustments → Inventory `ADJUST_STOCK` |
| Brand, Attribute, Variant | `/brands`, `/attributes`, `/variants` | `PRODUCT` | Product |
| Cart | `GET/POST/PUT/DELETE /cart/...` | JWT only | Orders (Redis cart) |
| Checkout | `POST /cart/checkout` | JWT only, **x-idempotency-key bắt buộc** | Orders `checkout_order` |
| Orders (xem) | `GET /orders`, `GET /orders/:id`, `GET /orders/:id/refunds` | `ORDER|READ` | Orders. **Không kiểm chủ sở hữu** |
| Orders (khách) | `GET /orders/:id/pay`, `POST /orders/:id/cancel`, `POST /orders/:id/return` | JWT only | Orders (kiểm chủ sở hữu, 404 nếu không phải chủ đơn) |
| Payment | `GET /payments/:orderId/transaction` | `PAYMENT|READ` | Payment `get_transaction` |
| Simulator | `GET /simulator/pay/:intentId`, `POST /simulator/pay/:intentId/:result` (`success`\|`fail`) | Miễn x-api-key, không JWT | Payment `simulate_payment` rồi `handle_payment_webhook` |
| Webhook | `POST /webhooks/payments` | x-api-key, không JWT | Payment `handle_payment_webhook` |
| Webhook | `POST /webhooks/shipping` | x-api-key, không JWT | Shipping `handle_shipping_webhook` |
| Shipment | `GET /shipments/:orderId` | `ORDER|READ` | Shipping `get_shipment` |
| Shipment | `POST /shipments/:orderId/deliver` | `ORDER|UPDATE` | Shipping `simulate_shipping_delivery` (404 khi production) |
| Vouchers | `POST /vouchers`, `GET /vouchers`, `GET /vouchers/available` | `PROMOTION` CREATE/READ | Promotion |
| Vouchers | `POST /vouchers/apply` | `PROMOTION|READ` | Promotion `apply_voucher` (cũ, không gắn đơn) |
| Reviews | `POST /reviews`, `GET /reviews/product/:productId` | `REVIEW` CREATE/READ | Review (verify đã mua qua Orders) |

Ghi chú:
- Route `POST /orders` (tạo đơn trực tiếp), `PATCH /orders/:id/status`, `/refunds*` **đã xoá**.
- `/cart/*` và `/addresses/*` không có `PermissionGuard`. `userId` lấy từ `req.user`, không từ body.
- Gateway chỉ chuyển tiếp checkout: không snapshot giá, không xoá cart. Orders lấy số lượng từ cart và giá từ Product.

---

## 8. Tài liệu liên quan

- [system-architecture.md](./system-architecture.md): tổng quan kiến trúc
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md): JWT login, verify, logout, RBAC
- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md): orchestration checkout v2, Outbox/Inbox
- [code-standards.md](./code-standards.md): validation, error handling, bảo mật
- [module-processing-flows.md](./module-processing-flows.md) §1: chi tiết pipeline Gateway
