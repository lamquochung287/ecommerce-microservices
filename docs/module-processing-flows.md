# Module Processing Flows — xử lý chi tiết từng module

**Ngày cập nhật**: 2026-10-05
**Nguồn**: đọc trực tiếp code. Mỗi mục: trách nhiệm → API/pattern → luồng xử lý từng bước → rule/ràng buộc → điểm cần lưu ý.

Xem luồng nghiệp vụ xuyên service ở [business-flows.md](./business-flows.md); đánh đổi thiết kế ở [design-trade-offs.md](./design-trade-offs.md).

---

## 0. Cơ chế chung

### 0.1 Khởi động một microservice
`main.ts` mỗi service: `setupTracing(name, metricsPort)` (OpenTelemetry → Jaeger OTLP HTTP `:4318`, Prometheus exporter) **trước** khi import Nest → `createMicroservice` (Transport.TCP, host `localhost`, port theo `PORT_TCP`) → `ValidationPipe` + service-specific `RpcExceptionFilter` → `enableShutdownHooks()`.

| Service | TCP | Metrics |
|---|---|---|
| gateway (HTTP) | 3000 | 9464 |
| user | 3001 | 9465 |
| orders | 3002 | 9467 |
| product | 3003 | 9466 |
| payment | 3004 | 9468 |
| notification | 3005 | 9469 |
| review | 3006 | 9470 |
| promotion | 3007 | 9471 |

(Port TCP lấy từ `libs/constant/port-tcp.constant.ts`; metrics port đối chiếu `prometheus.yml` và các `setupTracing(...)`. Host TCP đang **hardcode `localhost`** → chạy nhiều container cần đổi, xem trade-offs.)

### 0.2 Cấu hình & DB
- `CommonConfigModule` nạp `.env` và **validate bắt buộc** (`validateEnv`): `DB_*`, `REDIS_HOST/PORT`, `JWT_ACCESS_*`, `JWT_REFRESH_*`, `API_KEY` → thiếu là service không lên.
- `DatabaseModule`: TypeORM Postgres, `autoLoadEntities`, `synchronize:false`, **`migrationsRun:true`** (mọi service chạy chung thư mục migration khi khởi động), pool `max 50/min 5`.
- Đọc cấu hình runtime qua `ConfigService`; **ngoại lệ** hiện có: `JwtService` trong User fallback secret `'access_secret'/'refresh_secret'` nếu thiếu env (vô hiệu vì `validateEnv` đã bắt buộc, nhưng là fallback không an toàn nếu bỏ validate).

### 0.3 Xử lý lỗi qua TCP
Service ném `RpcException({statusCode,message})` hoặc `*Exception` của Nest → `AbstractRpcExceptionFilter` (libs/common) chuẩn hoá (kể cả map lỗi unique constraint sang message dễ đọc, override ở filter từng service) → Gateway `MicroserviceErrorHandler.handleError` suy ra HTTP status (ưu tiên `statusCode` → `status` → `name` → so khớp chuỗi message → mặc định 502) → `HttpExceptionFilter` đóng gói envelope `{success:false,data:null,error,message,meta}`.

### 0.4 Pattern CQRS dùng chung
Controller `@MessagePattern({cmd})` → `CommandBus/QueryBus.execute(...)` → Handler. Áp dụng ở product, orders, payment, review, promotion. **User và Notification không dùng CQRS** (service/controller trực tiếp) — chủ ý vì nghiệp vụ nhỏ.

---

## 1. Gateway (`apps/gateway`, HTTP :3000)

**Trách nhiệm**: điểm vào HTTP duy nhất; không chứa nghiệp vụ (trừ `cart/checkout` điều phối giá và upload media).

### Pipeline mỗi request (theo thứ tự thực thi)
1. `helmet()`, `compression()`, CORS (`CORS_ORIGINS`, credentials).
2. `RequestTrackerMiddleware` (mọi route trừ `/health`): gán/echo `x-request-id` (uuid nếu thiếu); lưu `x-idempotency-key`; **bắt buộc `x-api-key` == `API_KEY`** (sai → 401). Áp cho cả `/webhooks/payments`.
3. Guards: `ThrottlerGuard` global (100 req/phút/IP, storage Redis; `register`/`login` override 5/phút) → `JwtAuthGuard` (xem User) → `PermissionGuard`.
4. Interceptors: `IdempotencyInterceptor` → `TransformInterceptor`.
5. `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`): field lạ → 400.
6. Controller → Service → `TcpResilienceService.send(...)`.

### IdempotencyInterceptor (chi tiết)
Chỉ áp cho method ghi (≠ GET/OPTIONS/HEAD/TRACE) **có** header `x-idempotency-key` (không có header = bỏ qua hoàn toàn).
- Redis `idempotency:{key}` có `processing` → 409 "Request is already being processed".
- Có `resolved` → trả lại response đã cache với **HTTP 200** (kể cả lần đầu là 201).
- Chưa có → set `processing` (TTL 24h) → chạy handler → thành công: ghi `resolved`+response; lỗi: **xoá key** để client retry.
- Redis lỗi → **fail-open** (xử lý bình thường, mất bảo vệ trùng lặp).
- Lưu ý: key **không gắn user/route** — 2 user dùng cùng key sẽ thấy response của nhau (xem trade-offs).

### TcpResilienceService (circuit breaker)
Một `CircuitBreaker` (opossum) cho **mỗi serviceKey**: mở khi >50% lỗi trong cửa sổ 10s, thử lại half-open sau 15s; timeout 10s bằng RxJS. Khi breaker mở → fail-fast (lỗi map thành 502/408 theo message). Ngoại lệ: `JwtAuthGuard` gọi User trực tiếp (không qua breaker, timeout 5s). Breaker chỉ bảo vệ hướng Gateway→service; các lời gọi service→service (Orders→Product/Payment, Review→Orders, Notification→User) chỉ có timeout 10s, **không** có breaker/retry.

### Hành vi route đáng chú ý
- `POST /cart/checkout`: xem [business-flows §2.4](./business-flows.md#24-giỏ-hàng--checkout--đơn-hàng-luồng-trọng-tâm). Các lời gọi `GET_PRODUCT` chạy song song (`Promise.all`); sau khi tạo order mới `clearCart` — nếu clear lỗi thì đơn đã tạo nhưng giỏ còn (user có thể checkout lần nữa).
- `/cart/*`, `/addresses/*`: chỉ `JwtAuthGuard`, **không có `PermissionGuard`**; `userId` luôn lấy từ `req.user` (không tin body) — **trừ** `PUT/DELETE/POST :id` của address (không kiểm tra chủ sở hữu).
- `GET /user/profile/:userId`: `UserService.getProfile` ở Gateway là **stub rỗng** (trả `undefined`).
- `POST /user/logout` **không** có guard, nhận `{userId, sessionId}` từ body.

---

## 2. User Service (`apps/user`, :3001) — không CQRS

**Pattern**: `register`, `login`, `logout`, `verify_token`, `get_user_info`, `update_avatar`, + nhóm `ADDRESS_*`, `ROLE_*`.

### register
`findOne(email)` → tồn tại: `ConflictException` → `bcrypt.hash(password,10)` → `save` (spread nguyên DTO + password hash). `userId` (uuid) sinh tự động bởi cột `@Generated('uuid')`; `id` serial là PK nội bộ (dùng cho quan hệ Role/Address), `userId` là định danh công khai dùng ở mọi service khác.

### login
Tìm theo email → `bcrypt.compare` → `generateTokens` (cùng payload `{sub,email,sessionId}`; access/refresh ký **secret khác nhau**) → Redis `refresh_token:{userId}:{sessionId}` TTL cố định **7 ngày** (hardcode, không theo `JWT_REFRESH_EXPIRATION`).

### verify_token
`jwt.verify(access)` → Redis lookup session → `findOne(userId)` + `isActive` → `resolvePermissions`. Mọi lỗi bị gom thành `UnauthorizedException('Invalid or expired token')` (che mất nguyên nhân). Chi phí: **1 round-trip TCP + 1 Redis + 1-2 truy vấn DB cho mỗi request có xác thực** — là điểm nghẽn tiềm năng (xem trade-offs).

### Role & quyền
- `Role{name unique, permissions bigint}`; `UserRole{user,role} unique`.
- `assignRole` idempotent (đã có → trả bản ghi cũ); `removeRole` 404 nếu chưa có.
- `getEffectivePermissions`: `OR` mọi role; **null nếu user chưa có role nào** → fallback `User.permissions` (cột cũ, mặc định 0).
- `bigint` trong TypeORM trả về string; code ép `Number()` — an toàn tới 2^53 (đủ vì mới dùng ~11 bit).
- Xoá Role: `remove` (cascade `user_roles`) — user mất quyền ngay ở request kế tiếp.

### Address
- `createAddress`: nếu `isDefault` → trong 1 transaction bỏ default của mọi địa chỉ cũ rồi tạo mới.
- `setDefaultAddress`: transaction bỏ default tất cả của user chủ địa chỉ rồi đặt mặc định.
- `update/delete` theo `id`, **không kiểm tra quyền sở hữu** ở tầng service.

### Entities
`users(id serial, userId uuid, email unique, password, fullName?, avatarUrl?, permissions bigint=0, isActive=true, soft-delete)`, `roles`, `user_roles`, `addresses(…, isDefault)`.

---

## 3. Product Service (`apps/product`, :3003) — CQRS

**Command**: Create/Update/Delete Product, Brand, Attribute, Variant, `AdjustStock`. **Query**: GetProducts (phân trang), GetProduct, GetBrands, GetAttributes, GetVariants. **Event**: `ProductCreatedEvent` (handler hiện chỉ `console.log`).

### Mô hình dữ liệu
`Product{slug unique, price, stock, lowStockThreshold=10, version, isActive, images jsonb, category?, brand?, soft-delete}` — `ProductVariant{sku unique, price?, stock, version, attributeValues M:N, soft-delete}` — `Attribute{name unique} 1:N AttributeValue`.
`Product.stock` và `Variant.stock` là **hai kho độc lập** (không tự cộng dồn).

### AdjustStock — trái tim của tồn kho
Input `{productId | variantId, delta}` (cả hai thiếu → 400).
1. `dataSource.transaction`: đọc entity (variant ưu tiên nếu có `variantId`), `next = stock + delta`; `next < 0` → 409 "Không đủ tồn kho"; save.
2. `@VersionColumn` → TypeORM `UPDATE … WHERE version = ?`; nếu có request khác chen vào → `OptimisticLockVersionMismatchError`.
3. Retry **1 lần**; vẫn lỗi → 409 "Stock đang được cập nhật bởi request khác, thử lại".
- Dùng cho cả **trừ** (checkout), **hoàn** (compensation) và **điều chỉnh tay** (`POST /products/:id/stock-adjustments`, `PRODUCT|UPDATE`).
- `delta` cộng không có chặn trên; không có bảng lịch sử điều chỉnh (không audit).
- `lowStockThreshold` có cột nhưng **chưa có logic cảnh báo** dùng nó.

### Create/Update Product
- Create: kiểm tra category (404) và brand (404, nếu có) → `save` → publish event.
- Update: `categoryId` rỗng/null → 400; `brandId: null` → gỡ brand; còn lại `Object.assign` + save. Cập nhật qua `save()` cũng bump `version` → có thể làm một `AdjustStock` đang chạy bị retry.
- `getProduct` chỉ `relations:['category']` (không kèm brand/variants) — variants lấy riêng qua `GET /products/:id/variants`.

### Delete
Product: `remove` (hard delete, dù entity có `deletedAt`); Variant: `softRemove`. Xoá product **không** chặn khi đã có order tham chiếu (tham chiếu mềm).

---

## 4. Orders Service (`apps/orders`, :3002) — CQRS + Saga + Outbox

Module con: `CartModule` (Redis), `SagaModule` (client Product/Payment), `OutboxModule` (cron + client Order/Notification), `HealthModule`.

### Cart (`CartService`)
Redis string `cart:{userId}` = JSON `{userId, items[{productId,quantity}], updatedAt}`, TTL `CART_TTL_SECONDS` (mặc định 2.592.000s = 30 ngày, **gia hạn mỗi lần ghi**). Thao tác read-modify-write **không atomic** (2 request song song cùng user có thể ghi đè nhau — chấp nhận được với giỏ hàng của 1 người).

### CreateOrderHandler
Chi tiết bước ở [business-flows §2.4](./business-flows.md#24-giỏ-hàng--checkout--đơn-hàng-luồng-trọng-tâm). Bổ sung kỹ thuật:
- `InventoryReservationService.reserve`: **tuần tự** từng item (`ADJUST_STOCK -qty`, timeout 10s); lỗi → `release` các item đã trừ rồi ném lại lỗi gốc. `release` là **best-effort**: lỗi hoàn kho chỉ `logger.error("Compensation FAILED…")`, không ném → hàng có thể bị "mất" kho vĩnh viễn nếu Product down đúng lúc đó (không có retry/DLQ).
- `TcpPaymentProvider.capture`: bắt mọi lỗi/timeout → `{success:false, failureReason:'Payment service unavailable'}` → đi nhánh compensation (**đã sửa so với tài liệu cũ**: timeout nay được compensate).
- Nhưng: nếu Payment **đã charge thành công mà response bị timeout**, Orders huỷ đơn + hoàn kho trong khi tiền đã trừ (khách bị trừ tiền, đơn CANCELLED). Giảm nhẹ một phần nhờ idempotencyKey (lần retry sau trả lại kết quả cũ) nhưng **chưa có job đối soát**.
- Cửa sổ lỗi còn lại: crash process giữa S1 và S2 (hoặc giữa S2 và S3/S4) → kho đã trừ, đơn không có/kẹt `PENDING`; chưa có job quét "đơn PENDING quá hạn".
- Outbox chỉ được ghi ở S4 (khi đơn PROCESSING) và khi `UpdateOrderStatus`; đơn bị CANCELLED lúc checkout **không** phát event `order.status_updated`.

### UpdateOrderStatusHandler
1 transaction: đọc order → `canTransition` → đổi status → lưu → ghi Outbox `order.status_updated`. Không có kiểm tra "ai được đổi" ngoài `ORDER|UPDATE` ở Gateway; không có side-effect nghiệp vụ (hoàn kho khi CANCELLED, v.v.).

### Refund handlers
Create / Approve (transaction) / Reject — xem [business-flows §2.6](./business-flows.md#26-hoàn-tiền-refund). Lưu ý `approve` tính `totalRefunded` từ `refund.order.refunds` đã load ⇒ có race nếu 2 approve đồng thời (không lock). `create` kiểm tra tổng **không phải REJECTED** (gồm cả PENDING) nên 2 refund PENDING song song vẫn có thể cùng vượt qua kiểm tra (check-then-insert không lock).

### Queries
`GetOrders(userId?)` (không phân trang, mới nhất trước; không truyền `userId` = **trả toàn bộ đơn**), `GetOrder(id)` (404 nếu không có; eager load `items`), `GetRefunds(orderId)`.

### OutboxWorker
- `@Cron(EVERY_SECOND)`, cờ `isRunning` chống chồng lặp **trong 1 process** (nhiều instance Orders sẽ cùng đọc cùng row → phát trùng; chưa có `FOR UPDATE SKIP LOCKED`).
- Lấy tối đa 20 row `PENDING` theo `createdAt ASC` → `emit(eventType, payload)` tới **2 ClientProxy**: `ORDER_TCP_CLIENT` (trỏ lại chính Orders — không có handler nào, event bị bỏ) và `NOTIFICATION_TCP_CLIENT` → đánh dấu `PUBLISHED`.
- `emit` TCP là fire-and-forget: `try/catch` chỉ bắt lỗi đồng bộ; nếu Notification down, event vẫn bị đánh dấu `PUBLISHED` ⇒ ngữ nghĩa thực tế **at-most-once** tới Notification (retry/`FAILED` chủ yếu chỉ có tác dụng với lỗi lúc gửi). Hiểu nhầm phổ biến: "outbox = at-least-once" — ở đây chưa đạt.
- Hết `MAX_RETRY=5` → `FAILED`, không có alert/replay.

### Entities
`orders(userId, subtotal, taxAmount, shippingFee, totalAmount, status enum, 8 cột snapshot địa chỉ, items eager, refunds, soft-delete)`, `order_items(productId, quantity, unitPrice)`, `refunds(order, amount, reason, status)`, `outbox(eventType, payload jsonb, status, retryCount, publishedAt)`.
Order **không lưu `paymentTransactionId`** và không lưu voucher/discount.

---

## 5. Payment Service (`apps/payment`, :3004) — CQRS

| Pattern | Handler | Ghi chú |
|---|---|---|
| `charge_payment` | ChargePaymentHandler | idempotent theo `idempotencyKey` (unique DB) |
| `handle_payment_webhook` | HandlePaymentWebhookHandler | verify HMAC + khử trùng `eventId` |
| `get_transaction` | GetTransactionHandler | giao dịch mới nhất của `orderId`, trả `null` nếu chưa có |

### Charge
`findOne(idempotencyKey)` → có: trả lại (log warn). Không: `provider.charge` → lưu `PaymentTransaction` → `orderClient.emit(payment_succeeded|payment_failed, {orderId,transactionId,amount,failureReason})` → trả `{success,transactionId,failureReason?}`. Orders nhận event: `payment_succeeded` → PROCESSING→PAID, `payment_failed` → chỉ log (Saga đã hoàn kho + CANCELLED).
- Race: 2 request cùng key đồng thời cùng qua bước `findOne` → cả hai gọi provider; **DB unique** chỉ chặn bản ghi thứ hai (lỗi 'Payment already processed…') **sau khi đã charge 2 lần** với provider thật. Với provider giả lập không hậu quả; với provider thật cần gửi idempotency key sang provider hoặc lock theo key.
- `PaymentTransactionStatus` chỉ có `SUCCEEDED|FAILED` (chưa có PENDING/REFUNDED).

### Provider abstraction
`PAYMENT_PROVIDER` (DI token) với `charge()`/`verifyWebhook()`; hiện `PaymentModule` **bind cứng** `SimulatedPaymentProvider` (`useClass`) — chưa có chọn provider theo env dù comment trong code nhắc `PAYMENT_PROVIDER`. Muốn thêm VNPay/MoMo: implement interface + đổi binding thành `useFactory` đọc env. Orders cũng có interface `PaymentProvider` riêng (`TcpPaymentProvider`) — là adapter gọi sang service này.

---

## 6. Notification Service (`apps/notification`, :3005)

- Controller `OrderEventsController` (`@EventPattern('order.created' | 'order.status_updated')`) và `NotificationController` (`get_sent_notifications`).
- Quy trình mỗi event: lấy email người nhận qua `User.GET_USER_INFO` (lỗi → dùng `userId` làm recipient) → `EmailProvider.send` → ghi `sent_notifications`.
- **Không idempotent theo event**: Outbox phát trùng ⇒ gửi/ghi trùng. Không retry gửi email thất bại (chỉ ghi `FAILED`).
- Handler ném lỗi (vd DB lỗi) trong `@EventPattern` sẽ không có kênh phản hồi lại cho Orders (fire-and-forget).
- Subject/body hardcode tiếng Việt; `PushProvider` chưa được gọi.

---

## 7. Review Service (`apps/review`, :3006) — CQRS

`CreateReviewHandler`: gọi **đồng bộ** `Orders.GET_ORDER` → 4 điều kiện (tồn tại, đúng chủ, trạng thái `PAID|SHIPPED|DELIVERED`, chứa `productId`) → lưu. Unique `(userId, productId, orderId)` làm lớp chống review trùng ở DB (message do `ReviewRpcExceptionFilter` quy định). Phụ thuộc runtime vào Orders (Orders down ⇒ không review được). Không cập nhật rating tổng hợp lên Product.

---

## 8. Promotion Service (`apps/promotion`, :3007) — CQRS

`CreateVoucher` (unique `code`), `ApplyVoucher` (transaction + `pessimistic_write` lock theo row voucher — serialize các request apply cùng code, đảm bảo không vượt `usageLimit`), `GetVouchers`, `GetAvailableVouchers` (lọc `usageCount < usageLimit` **ở tầng ứng dụng** sau khi query `expiresAt > now`).
Code voucher **phân biệt hoa thường** (so khớp chính xác). Không có trường `isActive`, không giới hạn theo user/sản phẩm/danh mục.

---

## 9. Shared libs

| Lib | Nội dung & hành vi |
|---|---|
| `libs/common` | `CommonConfigModule` + `validateEnv`, `AbstractRpcExceptionFilter`, `PaginationQueryDto`/`PaginatedResult`, `setupTracing`; `constant/cmd.ts` là bản **trùng/cũ** của `GET_USER_INFO` (vẫn được User/Notification dùng → chưa xoá được ngay) |
| `libs/database` | `DatabaseModule`, `data-source.ts` (CLI), migrations (Init, Outbox, ProductCatalog, OrderSagaAndRefund, …) |
| `libs/cached` | `CachedModule`/`CachedService` (`get/set(ttl)/del`) trên `ioredis`, `RedisHealthIndicator` |
| `libs/media` | `MediaService` (MinIO): `ensureBucketExists`, `uploadFile`, `getPresignedUrl` |
| `libs/constant` | `PORT_TCP`, `NAME_SERVICE_TCP`, `*_MESSAGE_PATTERN`, `Action/ModuleName` (permission bitmask) |

---

## 10. Health & vận hành
Mỗi microservice có `HealthController` (`cmd: health_check`, Terminus ping DB; User thêm ping Redis); Gateway `GET /health` kiểm tra Redis + 3 service (user, product, order) — payment/notification/review/promotion **chưa** nằm trong health tổng hợp. Graceful shutdown bằng `enableShutdownHooks()`. Seed dữ liệu lớn: `npm run seed` (`scripts/seed.ts`: ~50.000 product, 20.000 order, 2.000 user, xuất CSV tài khoản, mật khẩu `Password123`).
