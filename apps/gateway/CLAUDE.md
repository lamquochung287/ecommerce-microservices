# Hướng dẫn cho AI Agents - Gateway Module

## Vai trò
API Gateway (HTTP :3000), entry duy nhất của Client. **Không chứa logic nghiệp vụ**, chỉ: auth/phân quyền, routing sang microservice qua TCP, chuẩn hoá response/error.
Chi tiết: [docs/module-processing-flows.md §1](../../docs/module-processing-flows.md), [docs/system-architecture-gateway-flow.md](../../docs/system-architecture-gateway-flow.md).

## Cấu trúc
`src/<domain>/` (user, product, orders, payment, review, promotion) = `*.controller.ts` + `*.service.ts` (ClientProxy) + `dto/`. `src/common/` = guard, interceptor, middleware, filter, `TcpResilienceService`, `MicroserviceErrorHandler`. `shared-clients.module.ts` đăng ký `ClientProxy` theo `NAME_SERVICE_TCP`.

## Pipeline mỗi request (thứ tự)
helmet/compression/CORS → `RequestTrackerMiddleware` (`x-request-id`, `x-idempotency-key`, **bắt buộc `x-api-key`** kể cả webhook) → `ThrottlerGuard` (100/phút/IP, Redis; register/login 5/phút) → `JwtAuthGuard` → `PermissionGuard` → `IdempotencyInterceptor` → `TransformInterceptor` → `ValidationPipe` (whitelist + forbidNonWhitelisted) → controller. Lỗi → `HttpExceptionFilter`.
Envelope: `{success, data, error, message, meta{statusCode,timestamp,path,method,requestId}}`; service trả `{data, meta}` thì meta được gộp (phân trang).

## Quy tắc
- Service gọi microservice **qua `TcpResilienceService.send(serviceKey, client, {cmd}, payload)`** (circuit breaker opossum: >50% lỗi/10s → open, 15s half-open; timeout 10s) rồi bọc `try/catch → MicroserviceErrorHandler.handleError(...)`. Không gọi `client.send` trần. Ngoại lệ duy nhất: `JwtAuthGuard` (timeout 5s).
- Route cần quyền: `@UseGuards(JwtAuthGuard, PermissionGuard)` + `@RequirePermission(ModuleName.X, Action.Y)`. `userId` của người dùng lấy từ `req.user` / `@GetUser()`, **không tin body/query**.
- Message pattern lấy từ `libs/constant/message-pattern.constant.ts` (không hardcode chuỗi).
- Không viết nghiệp vụ. Ngoại lệ hiện có: `cart.controller.ts → checkout` (snapshot giá từ Product rồi gọi Orders) và upload MinIO (`MediaService`).

## Gotchas / gap đã biết (đừng lặp lại, ưu tiên sửa nếu được giao)
- `POST /orders` nhận `userId`+`unitPrice` từ client (chỉ `/cart/checkout` lấy giá server-side). `GET /orders*`, `/refunds` không kiểm tra chủ sở hữu.
- Address `PUT/DELETE/POST :id/default` không kiểm tra chủ sở hữu. `/cart/*`, `/addresses/*` chỉ có `JwtAuthGuard` (không PermissionGuard).
- `POST /user/logout` không guard, tin `userId/sessionId` trong body. `UserService.getProfile` là stub rỗng.
- Idempotency: key không scope theo user/route, lần replay trả 200, Redis lỗi → fail-open.
- `/health` chỉ kiểm tra Redis + user/product/order.
- Upload chưa giới hạn size/mimetype.
- Mọi route (kể cả `/webhooks/payments`) yêu cầu `x-api-key`.
