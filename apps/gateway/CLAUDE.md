# Hướng dẫn cho AI Agents - Gateway Module

## Vai trò
API Gateway (HTTP :3000), entry duy nhất của Client. **Không chứa logic nghiệp vụ**, chỉ: auth/phân quyền, routing sang microservice qua TCP, chuẩn hoá response/error.
Chi tiết: [docs/module-processing-flows.md §1](../../docs/module-processing-flows.md), [docs/system-architecture-gateway-flow.md](../../docs/system-architecture-gateway-flow.md).

## Cấu trúc
`src/<domain>/` (user, product, orders, payment, shipping, review, promotion) = `*.controller.ts` + `*.service.ts` (ClientProxy) + `dto/`. `src/common/` = guard, interceptor, middleware, filter, `TcpResilienceService`, `MicroserviceErrorHandler`. `shared-clients.module.ts` đăng ký `ClientProxy` theo `NAME_SERVICE_TCP`.

## Pipeline mỗi request (thứ tự)
helmet/compression/CORS → `RequestTrackerMiddleware` (`x-request-id`, `x-idempotency-key`, **bắt buộc `x-api-key`** kể cả webhook; miễn: `/health`, `/simulator/*path` — xem `API_KEY_EXEMPT_ROUTES`) → `ThrottlerGuard` (100/phút/IP, Redis; register/login 5/phút) → `JwtAuthGuard` → `PermissionGuard` → `IdempotencyInterceptor` → `TransformInterceptor` → `ValidationPipe` (whitelist + forbidNonWhitelisted) → controller. Lỗi → `HttpExceptionFilter`.
Envelope: `{success, data, error, message, meta{statusCode,timestamp,path,method,requestId}}`; service trả `{data, meta}` thì meta được gộp (phân trang).

## Quy tắc
- Service gọi microservice **qua `TcpResilienceService.send(serviceKey, client, {cmd}, payload)`** (circuit breaker opossum: >50% lỗi/10s → open, 15s half-open; timeout mặc định 10s, tham số `timeoutMs` tuỳ chọn cho từng lần gọi) rồi bọc `try/catch → MicroserviceErrorHandler.handleError(...)`. Không gọi `client.send` trần. Ngoại lệ duy nhất: `JwtAuthGuard` (timeout 5s).
- Route cần quyền: `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission(ModuleName.X, Action.Y)`. `userId` của người dùng lấy từ `req.user` / `@GetUser()`, **không tin body/query**.
- Message pattern lấy từ `libs/constant/message-pattern.constant.ts` (không hardcode chuỗi).
- Không viết nghiệp vụ. Ngoại lệ hiện có: ghép tồn kho vào catalog (`product.controller.ts` + `inventory.service.ts`) và upload MinIO (`MediaService`).

## Checkout v2 và các route liên quan
- `POST /cart/checkout` (`@RequireIdempotencyKey()`): body `CheckoutDto` của Orders `{items:[{productId}], shippingAddress, voucherCode?}`; chỉ chuyển `ORDER.CHECKOUT {userId từ token, dto}`. Không snapshot giá, không xoá cart (Orders lo). Body có `userId/quantity/unitPrice` → 400 (`forbidNonWhitelisted`).
- `customer-orders.controller.ts` (chỉ `JwtAuthGuard`, Orders tự kiểm tra chủ sở hữu bằng `userId` từ token): `GET /orders/:id/pay` → `GET_PAYMENT_LINK`, `POST /orders/:id/cancel` → `CANCEL_ORDER {orderId, userId}`, `POST /orders/:id/return {reason}` → `REQUEST_RETURN {orderId, userId, reason}`. `:id` qua `ParseUUIDPipe`.
- **Idempotency** (`IdempotencyInterceptor`): route gắn `@RequireIdempotencyKey()` thiếu header → 400, Redis lỗi → 503 (fail-closed); route khác fail-open. Key Redis `idempotency:{userId|anon}:{METHOD}:{path}:{key}` (path thực, gồm id), marker `processing` TTL 120s, kết quả TTL 24h; replay trả đúng status gốc; đang xử lý → 409. Còn hở: get-rồi-set không nguyên tử (hai request đồng thời cùng key có thể cùng lọt); Orders vẫn chống trùng nhờ `replaces` ở checkout.
- **Simulator** `/simulator/pay/:intentId` (GET trang HTML, POST `/:result` = `success|fail`): miễn `x-api-key` (trình duyệt không gửi được), trả 404 khi `NODE_ENV=production`. POST gọi `PAYMENT.SIMULATE_PAYMENT` rồi `PAYMENT.HANDLE_WEBHOOK` với đúng `{payload, signature}` (Payment verify HMAC; không đổi thứ tự key). HTML không có script inline (CSP helmet), mọi giá trị đi qua `escapeHtml`.
- **Shipping**: `POST /webhooks/shipping` (không JWT, cần `x-api-key`, Shipping verify HMAC), `POST /shipments/:orderId/deliver` (`ORDER/UPDATE`), `GET /shipments/:orderId` (`ORDER/READ`).
- **Catalog**: `GET /products`, `GET /products/:id` gọi `INVENTORY.GET_AVAILABILITY` đúng một lần (timeout 1500ms) rồi ghép `available: number|null`, `stockStatus: IN_STOCK|OUT_OF_STOCK|UNKNOWN`; Inventory lỗi/timeout/breaker mở → `UNKNOWN`, không ném lỗi. Tồn kho cột `stock` của Product là dữ liệu cũ, không dùng để hiển thị.
- `POST /products/:id/stock-adjustments` → `INVENTORY.ADJUST_STOCK` (không còn qua Product).

## Gotchas / gap đã biết (đừng lặp lại, ưu tiên sửa nếu được giao)
- Các route cũ `POST /orders` (tin `userId`/`unitPrice` từ client), `PATCH /orders/:id/status`, `POST /refunds`, `/refunds/:id/approve|reject` **đã bị xoá**; còn `GET /orders`, `GET /orders/:id`, `GET /orders/:id/refunds` (`ORDER/READ`) **không kiểm tra chủ sở hữu** (khác với `/orders/:id/pay|cancel|return` đã có kiểm tra). `/vouchers/apply` giữ nguyên (tiêu lượt không gắn đơn).
- `src/gateway.controller.spec.ts` là boilerplate có sẵn, đang fail (thiếu provider `USER_SERVICE`).
- Address `PUT/DELETE/POST :id/default` không kiểm tra chủ sở hữu. `/cart/*`, `/addresses/*` chỉ có `JwtAuthGuard` (không PermissionGuard).
- `POST /user/logout` không guard, tin `userId/sessionId` trong body. `UserService.getProfile` là stub rỗng.
- `/health` chỉ kiểm tra Redis + user/product/order.
- Upload chưa giới hạn size/mimetype.
- Mọi route (kể cả `/webhooks/payments`, `/webhooks/shipping`) yêu cầu `x-api-key`, trừ `/health` và `/simulator/*`.
