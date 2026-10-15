# System Architecture — API Gateway Flow

**Ngày cập nhật**: 2026-09-28

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả chi tiết pipeline middleware/guard/interceptor mà mỗi HTTP request đi qua tại Gateway, và định dạng response envelope chuẩn.

---

## Request Flow qua Middleware & Filter

Thứ tự dưới đây theo đúng NestJS request lifecycle: **Middleware → Guards → Interceptors (trước handler) → Pipes → Handler → Interceptors (sau handler) → Exception Filters**. Guards LUÔN chạy trước interceptor và pipe — đây là điểm hay bị hỏi/nhầm khi phỏng vấn về NestJS.

```
HTTP Request (Client)
        ↓
[Helmet] - Security headers (X-Frame-Options, CSP, v.v.)
        ↓
[Compression] - Nén Gzip
        ↓
[CORS] - Kiểm tra Cross-Origin (env CORS_ORIGINS)
        ↓
[RequestTrackerMiddleware]
  ├─ Sinh x-request-id
  ├─ Validate header x-api-key (env API_KEY)
  ├─ Lấy x-idempotency-key (nếu có)
  └─ Log metadata request
        ↓
=== GUARDS (chạy trước Interceptor/Pipe) ===
[ThrottlerGuard] (Rate Limiting, đăng ký global qua APP_GUARD)
  ├─ Theo dõi bằng Redis
  ├─ Check: số request trong phút gần nhất ≤ limit
  ├─ Mặc định: 100/phút (hầu hết route)
  ├─ Chặt hơn: 5/phút (login/register)
  └─ Nếu vượt → 429 Too Many Requests
        ↓
[JwtAuthGuard] (route-scoped qua @UseGuards(), nếu route cần auth)
  ├─ Lấy Bearer token
  ├─ Verify signature & expiry
  ├─ Gọi USER_SERVICE.VERIFY_TOKEN (TCP, timeout 5s — KHÔNG qua TcpResilienceService/circuit breaker)
  ├─ Nếu fail → 401 Unauthorized
  └─ Gắn req.user (đã decode + permissions)
        ↓
[PermissionGuard] (route-scoped, nếu có decorator @RequirePermission)
  ├─ Check (user.permissions & required) === required
  └─ Nếu fail → 403 Forbidden
        ↓
=== INTERCEPTORS (trước handler, đăng ký global qua APP_INTERCEPTOR) ===
[IdempotencyInterceptor]
  ├─ Nếu x-idempotency-key đã có trong Redis & đã xử lý xong → trả về response đã cache
  ├─ Ngược lại → tiếp tục xử lý, cache response sau khi xong (TTL 24h)
  └─ Áp dụng cho: POST, PUT, DELETE (các method không an toàn/idempotent)
        ↓
=== PIPES (chạy ngay trước khi vào handler) ===
[ValidationPipe] (global, đăng ký trong main.ts)
  ├─ Parse & validate DTO (decorator class-validator)
  ├─ whitelist: true (bỏ qua field lạ)
  ├─ forbidNonWhitelisted: true (throw nếu có field thừa)
  └─ Nếu fail → 400 Bad Request
        ↓
CONTROLLER → SERVICE → GỌI RA NGOÀI (TCP tới microservices)
        ↓
=== INTERCEPTORS (sau handler, xử lý response) ===
[TransformInterceptor] (Bọc response)
  └─ Bọc kết quả: { success: true, data: {...}, error: null, message, meta }
        ↓
=== EXCEPTION FILTERS (bắt lỗi từ bất kỳ giai đoạn nào ở trên) ===
[HttpExceptionFilter] (Map exception)
  ├─ Bắt HttpException, RpcException, v.v.
  ├─ Map sang HTTP status + định dạng envelope
  ├─ Log lỗi
  └─ Trả về error response
        ↓
HTTP Response (Client) với status & body phù hợp
```

---

## Request/Response Envelope

Toàn bộ response từ Gateway (thành công hoặc lỗi) đều theo 1 format chuẩn, giúp client xử lý nhất quán:

```jsonc
// Thành công
{
  "success": true,
  "data": { /* dữ liệu thực tế */ },
  "error": null,
  "message": "Operation successful",
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-09-28T10:30:00Z",
    "duration": 125 // ms
  }
}

// Lỗi
{
  "success": false,
  "data": null,
  "error": {
    "statusCode": 400,
    "message": "Email already exists",
    "error": "BadRequest",
    "timestamp": "2026-09-28T10:30:00Z"
  },
  "message": "Request failed",
  "meta": {
    "requestId": "uuid"
  }
}
```

- `TransformInterceptor` tự động unwrap các response dạng `{data, meta}` (dùng cho pagination) để giữ format đồng nhất.
- `HttpExceptionFilter` normalize mọi loại lỗi (HttpException chuẩn, lỗi thô từ microservice, lỗi generic) về cùng 1 khuôn `error` object.

---

## Ghi chú: Gateway không chứa business logic

Theo `apps/gateway/CLAUDE.md`, Gateway chỉ đóng vai trò:
- AuthN/AuthZ (JWT + permission bitmask)
- Định tuyến/forward request tới microservices qua TCP
- Map lỗi `RpcException` → `HttpException` chuẩn

Toàn bộ logic nghiệp vụ (tính giá, kiểm tra tồn kho, xử lý thanh toán...) nằm trong các microservice tương ứng, **không** nằm trong Gateway controller/service.

> **Lưu ý chính xác (đã verify với code) — có 2 đường tạo order khác nhau, hành vi khác nhau**:
> - `POST /cart/checkout` (`CartController.checkout`, flow khách hàng thực tế dùng): CÓ re-price — với mỗi item trong cart, gọi `productService.getProduct(productId)` để lấy giá gốc, set `unitPrice` server-side từ đó rồi mới gọi `ordersService.createOrder(...)`. Đường này an toàn trước price tampering.
> - `POST /orders` (`OrdersController.createOrder`, endpoint tạo order trực tiếp, yêu cầu quyền `ORDER.CREATE`): forward thẳng `CreateOrderDto` (bao gồm `unitPrice` client tự gửi) sang Orders service, **không** gọi Product để re-validate. Đây là nguồn gốc thật sự của gap "unitPrice không được re-validate" — xem [project-roadmap.md](./project-roadmap.md).
>
> Nói cách khác: gap về price-trust chỉ tồn tại ở đường tạo order trực tiếp/admin, không phải ở flow checkout giỏ hàng thông thường của khách hàng.

---

## Tài liệu liên quan

- [system-architecture.md](./system-architecture.md) — Tổng quan kiến trúc
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) — Chi tiết JWT login/verify/refresh/logout
- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) — Orchestration checkout v2, Outbox/Inbox
- [code-standards.md](./code-standards.md) — Quy ước validation, error handling, security
