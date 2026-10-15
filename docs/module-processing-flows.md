# Module Processing Flows — xử lý chi tiết từng module

**Ngày cập nhật**: 2026-10-15
**Nguồn**: đọc trực tiếp code (checkout v2 đã cutover). Phần chưa chạy trên Postgres/Kafka thật được ghi rõ "chưa kiểm chứng trên stack thật". Mỗi mục: trách nhiệm → API/pattern → luồng xử lý từng bước → rule/ràng buộc → điểm cần lưu ý.

Xem luồng nghiệp vụ xuyên service ở [business-flows.md](./business-flows.md); đánh đổi thiết kế ở [design-trade-offs.md](./design-trade-offs.md).

---

## 0. Cơ chế chung

### 0.1 Khởi động một microservice
`main.ts` mỗi service: `setupTracing(name, metricsPort)` (OpenTelemetry → Jaeger OTLP HTTP `:4318`, Prometheus exporter) **trước** khi import Nest. Service chỉ dùng TCP (user, product, review) → `createMicroservice` (Transport.TCP, host `localhost`). Service tham gia Kafka (orders, payment, inventory, shipping, promotion, notification) là **app hybrid**: `NestFactory.create` + `connectMicroservice(TCP)` + `connectMicroservice(KAFKA, {group})` + `startAllMicroservices()` + `init()` (không listen HTTP), gọi `ensureKafkaTopics(...)` trước khi start (broker tắt auto-create topic; Kafka tắt lúc boot → exit 1). Mọi `@MessagePattern` gắn `Transport.TCP`, mọi `@EventPattern` gắn `Transport.KAFKA` (nếu không, pattern bị đăng ký cho cả hai server và `{"cmd":...}` thành tên topic không hợp lệ). Sau đó `ValidationPipe` + service-specific `RpcExceptionFilter` → `enableShutdownHooks()`.

| Service | TCP | Kafka group | Metrics |
|---|---|---|---|
| gateway (HTTP) | 3000 | — | 9464 |
| user | 3001 | — | 9465 |
| orders | 3002 | `orders-service` | 9467 |
| product | 3003 | — | 9466 |
| payment | 3004 | `payment-service` | 9468 |
| notification | 3005 | `notification-service` | 9469 |
| review | 3006 | — | 9470 |
| promotion | 3007 | `promotion-service` | 9471 |
| inventory | 3008 | `inventory-service` | 9472 |
| shipping | 3009 | `shipping-service` | 9473 |

(Port TCP lấy từ `libs/constant/port-tcp.constant.ts`; metrics port đối chiếu các `setupTracing(...)` — `prometheus.yml` chưa có target cho inventory/shipping. Host TCP đang **hardcode `localhost`** → chạy nhiều container cần đổi, xem trade-offs.)

### 0.2 Cấu hình & DB
- `CommonConfigModule` nạp `.env` và **validate bắt buộc** (`validateEnv`): `DB_*`, `REDIS_HOST/PORT`, `JWT_ACCESS_*`, `JWT_REFRESH_*`, `API_KEY`, `KAFKA_BROKERS`, `PAYMENT_WEBHOOK_SECRET`, `SHIPPING_WEBHOOK_SECRET` → thiếu một biến là **mọi** service không lên (kể cả Gateway/User, vì dùng chung `validateEnv`; jest import `@lib/common` không mock cũng sẽ ném lỗi nếu shell thiếu các biến này).
- `DatabaseModule`: TypeORM Postgres, `autoLoadEntities`, `synchronize:false`, **`migrationsRun:true`** (mọi service chạy chung thư mục migration khi khởi động), pool `max 50/min 5`.
- Đọc cấu hình runtime qua `ConfigService`; **ngoại lệ** hiện có: `JwtService` trong User fallback secret `'access_secret'/'refresh_secret'` nếu thiếu env (vô hiệu vì `validateEnv` đã bắt buộc, nhưng là fallback không an toàn nếu bỏ validate).

### 0.3 Xử lý lỗi qua TCP
Service ném `RpcException({statusCode,message})` hoặc `*Exception` của Nest → `AbstractRpcExceptionFilter` (libs/common) chuẩn hoá (kể cả map lỗi unique constraint sang message dễ đọc, override ở filter từng service) → Gateway `MicroserviceErrorHandler.handleError` suy ra HTTP status (ưu tiên `statusCode` → `status` → `name` → so khớp chuỗi message → mặc định 502) → `HttpExceptionFilter` đóng gói envelope `{success:false,data:null,error,message,meta}`.

### 0.3a Messaging Kafka (`libs/messaging`)
- **Outbox**: mọi event/command ra ngoài ghi bằng `OutboxWriter.append(manager, {topic, type, orderId, payload})` **cùng transaction** với đổi state; row có `source` (service sở hữu), `topic`, `key = orderId`, `eventId`, `seq`. `OutboxRelayService` mỗi service chỉ relay row `source` của mình: `SELECT ... FOR UPDATE SKIP LOCKED` (an toàn nhiều instance, giữ thứ tự theo key) → `KafkaProducerService.send` (acks=all, idempotent producer) → **chỉ đánh dấu `PUBLISHED` sau khi broker ack**; lỗi → backoff + `retryCount`, quá `OUTBOX_MAX_RETRY` → `FAILED` + metric `outbox_failed_total{source}`. ⇒ **at-least-once**. Envelope `{eventId, type, orderId, occurredAt, version, payload}`.
- **Inbox + consumer**: `KafkaConsumerRunner.run({consumer, topic, message, handle, onExhausted})` — mở 1 transaction: `INSERT processed_messages (consumer, eventId) ON CONFLICT DO NOTHING` (trùng → bỏ qua) → `handle(manager)` (đổi state + ghi outbox cùng transaction) → commit → `afterCommit`. Lỗi → rollback (inbox cũng rollback) → retry tối đa `KAFKA_CONSUMER_MAX_ATTEMPTS`=3 → gửi `<topic>.dlq` → `onExhausted` (vd Shipping phát `ShipmentFailed`, Payment phát `PaymentRefundFailed`). Envelope sai → DLQ. `onExhausted` hoặc gửi DLQ lỗi thì runner ném để Kafka giao lại.
- Topic: `order-events`, `payment-events`, `payment-commands`, `inventory-commands`, `inventory-events`, `shipping-commands`, `shipping-events` (+ `.dlq`); partition key = `orderId` để giữ thứ tự theo đơn. Consumer `fromBeginning:false` → khởi động consumer trước khi producer phát message đầu tiên.
- Chưa kiểm chứng trên Kafka thật qua toàn luồng (relay/producer có int-spec đã chạy ở nền tảng; phần còn lại chỉ unit test mock).

### 0.4 Pattern CQRS dùng chung
Controller `@MessagePattern({cmd})` → `CommandBus/QueryBus.execute(...)` → Handler. Áp dụng ở product, orders, payment, review, promotion, inventory, shipping. Consumer Kafka là controller mỏng → `CommandBus` (`Handle...MessageCommand`) → handler gọi `KafkaConsumerRunner`. **User và Notification không dùng CQRS** (service/controller trực tiếp) — chủ ý vì nghiệp vụ nhỏ.

---

## 1. Gateway (`apps/gateway`, HTTP :3000)

**Trách nhiệm**: điểm vào HTTP duy nhất; không chứa nghiệp vụ (ngoại lệ: ghép tồn kho vào catalog, simulator thanh toán, upload media). `POST /cart/checkout` chỉ chuyển tiếp sang Orders.

### Pipeline mỗi request (theo thứ tự thực thi)
1. `helmet()`, `compression()`, CORS (`CORS_ORIGINS`, credentials).
2. `RequestTrackerMiddleware` (mọi route trừ `/health`, `/simulator/*`): gán/echo `x-request-id` (uuid nếu thiếu); lưu `x-idempotency-key`; **bắt buộc `x-api-key` == `API_KEY`** (sai → 401). Áp cho cả `/webhooks/payments`, `/webhooks/shipping`; miễn: `/health` và `/simulator/*` (xem `API_KEY_EXEMPT_ROUTES`, trình duyệt không gửi được header).
3. Guards: `ThrottlerGuard` global (100 req/phút/IP, storage Redis; `register`/`login` override 5/phút) → `JwtAuthGuard` (xem User) → `PermissionGuard`.
4. Interceptors: `IdempotencyInterceptor` → `TransformInterceptor`.
5. `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`): field lạ → 400.
6. Controller → Service → `TcpResilienceService.send(...)`.

### IdempotencyInterceptor (chi tiết)
Áp cho method ghi (≠ GET/OPTIONS/HEAD/TRACE). Key phải khớp `^[A-Za-z0-9._:-]{1,128}$` (sai → 400). Route gắn `@RequireIdempotencyKey()` (hiện: `POST /cart/checkout`) **bắt buộc** có header (thiếu → 400); route khác thiếu header = bỏ qua.
- Key Redis `idempotency:{userId|anon}:{METHOD}:{path thực, gồm id}:{key}` → 2 user/2 route/2 đơn dùng cùng key không đụng nhau.
- Có marker `processing` (TTL 120s, không khoá 24h nếu request chết) → 409 "Request is already being processed".
- Có kết quả đã lưu (TTL 24h) → trả lại response cache với **đúng status gốc** (vd 201).
- Chưa có → set `processing` → chạy handler → thành công: lưu kết quả xong mới trả response; lỗi: **xoá key** (client retry được).
- Redis lỗi: route bắt buộc → **503 fail-closed** (Orders không bị gọi); route thường → fail-open.
- Còn hở: get-rồi-set không nguyên tử (`CachedService` không có `SET NX`) — hai request đồng thời cùng key có thể cùng lọt; Orders vẫn chống trùng nhờ `replaces` ở checkout.

### TcpResilienceService (circuit breaker)
Một `CircuitBreaker` (opossum) cho **mỗi serviceKey**: mở khi >50% lỗi trong cửa sổ 10s, thử lại half-open sau 15s; timeout 10s bằng RxJS. Khi breaker mở → fail-fast (lỗi map thành 502/408 theo message). Ngoại lệ: `JwtAuthGuard` gọi User trực tiếp (không qua breaker, timeout 5s). `send` nhận `timeoutMs` tuỳ chọn (catalog ghép tồn kho dùng 1500ms; mặc định 10s). Breaker chỉ bảo vệ hướng Gateway→service; các lời gọi service→service (Orders→Inventory/Payment/Product/Promotion, Review→Orders, Notification→User) chỉ có timeout 10s, **không** có breaker/retry.

### Hành vi route đáng chú ý
- `POST /cart/checkout` (idempotency bắt buộc): chỉ chuyển `ORDER.CHECKOUT {userId từ token, dto}`; DTO `{items:[{productId}], shippingAddress, voucherCode?}` (xem [business-flows §2.4](./business-flows.md#24-giỏ-hàng--checkout-v2--đơn-hàng-luồng-trọng-tâm)). Không snapshot giá, không xoá cart.
- `customer-orders.controller.ts` (chỉ `JwtAuthGuard`; Orders tự kiểm chủ sở hữu bằng `userId` từ token): `GET /orders/:id/pay`, `POST /orders/:id/cancel`, `POST /orders/:id/return {reason}`.
- `GET /orders`, `GET /orders/:id`, `GET /orders/:id/refunds` (`ORDER|READ`): **không** kiểm tra chủ sở hữu. Route cũ `POST /orders`, `PATCH /orders/:id/status`, `/refunds*` đã xoá.
- Simulator `GET /simulator/pay/:intentId` (HTML) và `POST /simulator/pay/:intentId/:result`: miễn `x-api-key`, 404 khi `NODE_ENV=production`; POST gọi `PAYMENT.SIMULATE_PAYMENT` rồi `PAYMENT.HANDLE_WEBHOOK` với đúng `{payload, signature}`.
- Shipping: `POST /webhooks/shipping` (không JWT, HMAC ở Shipping), `POST /shipments/:orderId/deliver` (`ORDER|UPDATE`), `GET /shipments/:orderId` (`ORDER|READ`).
- Catalog: `GET /products`, `GET /products/:id` ghép `available`/`stockStatus` từ `INVENTORY.GET_AVAILABILITY` (1 lần, 1500ms; lỗi → `UNKNOWN`). `POST /products/:id/stock-adjustments` → `INVENTORY.ADJUST_STOCK`. Sort/lọc theo `stock` đã bỏ.
- `/cart/*`, `/addresses/*`: chỉ `JwtAuthGuard`, **không có `PermissionGuard`**; `userId` lấy từ `req.user` (không tin body) — **trừ** `PUT/DELETE/POST :id` của address (không kiểm tra chủ sở hữu).
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

**Command**: Create/Update/Delete Product, Brand, Attribute, Variant. **Query**: GetProducts (phân trang), GetProduct, GetBrands, GetAttributes, GetVariants. **Event**: `ProductCreatedEvent` (handler hiện chỉ `console.log`). Product **chỉ còn catalog**: tồn kho thuộc Inventory (§8a), `AdjustStock` của Product đã xoá.

### Mô hình dữ liệu
`Product{slug unique, price, lowStockThreshold=10, version, isActive, images jsonb, category?, brand?, soft-delete}` — `ProductVariant{sku unique, price?, version, attributeValues M:N, soft-delete}` — `Attribute{name unique} 1:N AttributeValue`. Không còn cột `stock` (migration chốt đã bỏ; trước khi bỏ, migration bù các dòng còn thiếu vào `stock_items`). Tạo Product/Variant không tạo `stock_items`; cho tới khi `ADJUST_STOCK` lần đầu, available = 0 (thiếu dòng = 0).
- `lowStockThreshold` có cột nhưng **chưa có logic cảnh báo** dùng nó.
- `GetProducts` sort whitelist `name|price|createdAt`.

### Create/Update Product
- Create: kiểm tra category (404) và brand (404, nếu có) → `save` → publish event.
- Update: `categoryId` rỗng/null → 400; `brandId: null` → gỡ brand; còn lại `Object.assign` + save.
- `getProduct` chỉ `relations:['category']` (không kèm brand/variants) — variants lấy riêng qua `GET /products/:id/variants`.

### Delete
Product: `remove` (hard delete, dù entity có `deletedAt`); Variant: `softRemove`. Xoá product **không** chặn khi đã có order tham chiếu (tham chiếu mềm).

---

## 4. Orders Service (`apps/orders`, :3002 + Kafka) — CQRS + Orchestrator + Outbox/Inbox

Module con: `CartModule` (Redis), `ServiceClientsModule` (client TCP tới Inventory/Payment/Product/Promotion), `MessagingModule` (outbox relay + inbox), `ScheduleModule`, `HealthModule`. Saga đồng bộ cũ (`CreateOrderHandler`, `saga/`, `ConfirmOrderPaymentHandler`, `PaymentEventsController` TCP, `OutboxWorker`) **đã bị xoá**.

### Cart (`CartService`)
Redis string `cart:{userId}` = JSON `{userId, items[{productId,quantity}], updatedAt}`, TTL `CART_TTL_SECONDS` (mặc định 2.592.000s = 30 ngày, **gia hạn mỗi lần ghi**). Thao tác read-modify-write **không atomic** (2 request song song cùng user có thể ghi đè nhau — chấp nhận được với giỏ hàng của 1 người). `deductItems(userId, items)`: trừ đúng productId + số lượng đã đặt (phần dư giữ lại; không ghi khi không có món khớp) — gọi sau khi transaction `PAID` commit.

### Order state (`order-state/`)
- `OrderTransitionService.transition(manager, order, to, patch, messages)`: `canTransition` → `UPDATE orders SET status, version = version+1, ...patch WHERE id AND version` → 0 dòng = `OrderVersionConflictError` (`RpcException` 409) → ghi Outbox `OrderStatusChanged` + `messages[]` (chỉ sau khi UPDATE thành công, cùng manager). `updateWithVersion` cho thay đổi cột không đổi status (gắn intent, `refundStatus`).
- `OrderCancellationService.cancelUnpaid(manager, order, reason, {releaseInventory})`: `CANCELLED` + `CancelPaymentIntent` + (tuỳ chọn) `ReleaseInventory` + `OrderCancelled{paid:false, cancelReason, voucherCode?}`. `cancelPaid(manager, order, reason, {restock, cancelShipment?})`: `refundStatus=PENDING` + `RefundPayment{amount: total − ship}` + `RestockInventory?` + `CancelShipment?` + `OrderCancelled{paid:true, ...}`.

### Checkout (`CheckoutHandler`, `PreparePaymentHandler`)
Các bước và rule xem [business-flows §2.4](./business-flows.md#24-giỏ-hàng--checkout-v2--đơn-hàng-luồng-trọng-tâm). Bổ sung kỹ thuật:
- Orders không có `ValidationPipe` ở biên TCP nên tự validate (`plainToInstance + validateSync({whitelist:true})`): field lạ bị loại, `shippingAddress` thiếu/items rỗng/UUID sai → 400. `userId` chỉ lấy từ tham số TCP.
- `OrderPricingService.priceItems(lines, voucherCode?)`: giá từ `ProductClient` (404/inactive/giá sai → 400; lỗi khác giữ nguyên), `discountAmount` từ Promotion; `refundAmountOf = total − ship`.
- Tìm `replaces`: một raw query `orders JOIN order_items` (userId, `PENDING_PAYMENT`, `deletedAt IS NULL`, `DISTINCT`, `LIMIT 50` khớp giới hạn Inventory) — **chưa kiểm chứng trên Postgres thật** (có int-spec viết sẵn, chưa chạy). Huỷ đơn cũ trong TX tạo đơn mới: lệch version → bỏ qua; lỗi khác → rollback + `Inventory.RELEASE(orderId mới)`.
- Gắn intent sau checkout dùng `updateWithVersion`; mọi lỗi ở bước này chỉ log, vẫn trả `PENDING_PAYMENT + payment_url`.
- Cửa sổ lỗi còn lại: crash sau `Inventory.RESERVE`/`RESERVE_VOUCHER` nhưng trước TX tạo đơn → kho tự hết hạn (job Inventory), **lượt voucher bị giữ vĩnh viễn**; `Inventory.RESERVE` trả luôn phần giữ của đơn `replaces`, nếu sau đó voucher/TX lỗi thì đơn cũ còn `PENDING_PAYMENT` mà mất reservation (chốt #2/scheduler huỷ khi tới).

### Consumer Kafka (3 controller mỏng → `HandlePayment|Inventory|ShippingEventCommand`)
Mỗi lần xử lý (kể cả retry) đọc lại đơn trong TX rồi quyết định theo trạng thái hiện tại; mọi đổi state qua `OrderTransitionService`.
- **payment-events**: `PaymentSucceeded` — `PENDING_PAYMENT` → `PAID` + outbox `OrderPaid{userId, voucherCode?}`, `CommitInventory`; trừ cart ở `afterCommit` (lỗi chỉ log); `CANCELLED` + `refundStatus=NONE` → `refundStatus=PENDING` + `RefundPayment{amount của event, reason:'LATE_PAYMENT'}` (amount không hợp lệ → ném → retry → DLQ); trạng thái khác/đã xử lý → no-op. `PaymentFailed` → `cancelUnpaid(PAYMENT_FAILED, release)`. `PaymentRefunded`: đơn `CANCELLED` chưa `SUCCEEDED` → `refundStatus=SUCCEEDED`, `refundedAmount`, `refundedAt`; `REFUNDING` → `REFUNDED` + `RestockInventory` + SQL `UPDATE refunds SET status='COMPLETED' ... AND status='PENDING'`. `PaymentRefundFailed`: `CANCELLED` → `refundStatus=FAILED` + log error; `REFUNDING` → giữ nguyên + log error.
- **inventory-events**: `InventoryCommitted` — `PAID` → `FULFILLING` + `CreateShipment{recipient, items}`; `CANCELLED` → bỏ qua. `InventoryCommitFailed` → `cancelPaid(INVENTORY_COMMIT_FAILED, {restock:false})`.
- **shipping-events**: `ShipmentCreated` — `FULFILLING` → `SHIPPED` (+`trackingCode`; thiếu → ném); `CANCELLED` → outbox `CancelShipment`. `ShipmentDelivered` — `SHIPPED` → `DELIVERED` (+`deliveredAt`; không parse được → ném). `ShipmentFailed` — `FULFILLING` → `cancelPaid(SHIPMENT_FAILED, {restock:true, cancelShipment:false})`; `CANCELLED` → no-op.

### Huỷ / hoàn hàng (`CancelOrderHandler`, `RequestReturnHandler`)
Mỗi request = 1 `dataSource.transaction` (đọc đơn + transition + outbox). Quy tắc xem [business-flows §2.5-2.6](./business-flows.md#25-vòng-đời-đơn-hàng-state-machine). Không phải chủ đơn → 404; lệch version → 409 (không retry). Hoàn hàng chèn Refund (`manager.insert(Refund, {order:{id}, amount, reason, status:PENDING})`) sau transition — SQL raw/insert này **chưa kiểm chứng trên Postgres thật**.

### Scheduler (`OrderLifecycleScheduler`)
`@Cron` 30 giây → `ExpirePendingOrdersCommand`; 10 phút → `CompleteDeliveredOrdersCommand`; mỗi job có cờ chống chạy chồng, batch 100 (`ORDER_LIFECYCLE_BATCH_SIZE`). Handler: `find` ứng viên (ORDER BY `expiresAt`/`deliveredAt` ASC) rồi **mỗi đơn 1 TX**, đọc lại + kiểm lại điều kiện; lệch version/đổi trạng thái → `skipped`; lỗi khác → `failed` + log, không chặn đơn sau.

### Queries
`GetOrders(userId?)` (không phân trang, mới nhất trước; không truyền `userId` = **trả toàn bộ đơn**), `GetOrder(id)` (404 nếu không có; eager load `items`; **không** kiểm chủ sở hữu), `GetRefunds(orderId)`.

### Entities
`orders(userId, subtotal, taxAmount, shippingFee, totalAmount, status enum[9 trạng thái], version, expiresAt, paidAt, deliveredAt, cancelReason, refundStatus, refundedAmount, refundedAt, paymentIntentId, paymentCheckoutUrl, trackingCode, voucherCode, discountAmount, 8 cột snapshot địa chỉ, items eager, refunds, soft-delete)`, `order_items(productId, quantity, unitPrice)`, `refunds(order, amount, reason, status PENDING|APPROVED|REJECTED|COMPLETED)` (chỉ còn dùng PENDING/COMPLETED), bảng dùng chung `outbox`, `processed_messages` (`@lib/messaging`).

---

## 5. Payment Service (`apps/payment`, :3004 + Kafka) — CQRS

| Kênh | Pattern/type | Handler | Ghi chú |
|---|---|---|---|
| TCP | `create_payment_intent` | CreatePaymentIntentHandler | idempotent theo `idempotencyKey` (= orderId, unique DB); trả intent cũ ở mọi trạng thái |
| TCP | `handle_payment_webhook` | HandlePaymentWebhookHandler | HMAC + khử trùng `eventId` + `PaymentSucceeded/Failed` qua outbox |
| TCP | `get_payment_intent` | GetPaymentIntentHandler | `{intentId, orderId, amount, status, expiresAt, expired}` |
| TCP | `simulate_payment` | SimulatePaymentHandler | `{payload, signature}` cho simulator (404 khi production) |
| TCP | `get_transaction` | GetTransactionHandler | giao dịch mới nhất của `orderId`, `null` nếu chưa có |
| Kafka `payment-commands` | `CancelPaymentIntent` | CancelPaymentIntentHandler | `UPDATE ... WHERE orderId AND status='PENDING'` → `CANCELLED` (nguyên tử với webhook) |
| Kafka `payment-commands` | `RefundPayment{amount, reason}` | RefundPaymentHandler | unique `payment_refunds.orderId`; chỉ ghi trạng thái cuối `SUCCEEDED|FAILED`; replay phát lại kết quả đã lưu; hết retry → `onExhausted` phát `PaymentRefundFailed` |

`PaymentTransaction` = payment intent: `PENDING|SUCCEEDED|FAILED|CANCELLED`, `expiresAt` (= hạn giữ hàng Orders gửi), `checkoutUrl`, `paidAt`. Event ra `payment-events` (outbox): `PaymentSucceeded{intentId, amount}`, `PaymentFailed{reason}`, `PaymentRefunded{refundId, amount}`, `PaymentRefundFailed{reason}`. `CHARGE_PAYMENT` đã xoá.

- Webhook (1 transaction): verify HMAC-SHA256 trên `JSON.stringify(payload)` bằng `timingSafeEqual` (sai → 400) → `INSERT payment_webhook_logs ON CONFLICT (eventId) DO NOTHING` (trùng → `{alreadyProcessed:true}`) → khoá intent `FOR UPDATE`, đối chiếu `orderId`/`amount` (lệch → 400, rollback cả log) → `SUCCEEDED` khi intent `PENDING|CANCELLED` (kể cả đã huỷ: tiền đã thu, Orders quyết định hoàn); `FAILED` khi `PENDING`; còn lại no-op.
- Simulator: `PAYMENT_SIM_MODE` `manual` (mặc định) | `auto-success` | `auto-fail` (hẹn giờ `PAYMENT_SIM_DELAY_MS`, timer `unref`, mất khi restart, tắt khi production). eventId tất định `${intentId}:${result}` nên bấm lặp = webhook trùng; không chặn khi intent đã `CANCELLED`/hết hạn (mô phỏng trả muộn).
- Provider: DI token `PAYMENT_PROVIDER` (`useFactory` + `ConfigService`) với `createIntent`, `refund`, `signWebhook`, `verifyWebhook`; `buildWebhook` là phần riêng của simulator. Muốn thêm cổng thật: implement interface + đổi binding.
- Refund `FAILED` không thử lại được (unique `orderId`) — admin xử lý tay. HMAC trên `JSON.stringify` phụ thuộc thứ tự key (provider thật phải ký raw body).
- Chưa kiểm chứng trên Postgres/Kafka thật: migration `AddPaymentIntentAndRefund`, int-spec webhook/refund.

---

## 6. Notification Service (`apps/notification`, :3005 + Kafka consumer)

- `OrderEventsController`: một `@EventPattern('order-events', Transport.KAFKA)` → `KafkaConsumerRunner` (group `notification-service`, inbox theo `eventId`, retry 3 → DLQ `order-events.dlq`); `NotificationController` (`get_sent_notifications`, TCP).
- Quy trình: type `OrderCreated`/`OrderStatusChanged` → lấy email qua `User.GET_USER_INFO` (làm trước transaction; lỗi → dùng `userId` làm recipient) → `EmailProvider.send` trong `handle` → ghi `sent_notifications`. `OrderPaid`/`OrderCancelled`/type khác: chỉ đánh dấu inbox.
- Idempotent theo `eventId` (inbox). Provider ném lỗi → rollback + retry → DLQ; `success:false` → lưu `FAILED`. Email vẫn có thể trùng nếu commit lỗi sau khi provider đã gửi.
- Subject/body hardcode tiếng Việt; `PushProvider` chưa được gọi. Chưa kiểm chứng trên Kafka thật.

---

## 7. Review Service (`apps/review`, :3006) — CQRS

`CreateReviewHandler`: gọi **đồng bộ** `Orders.GET_ORDER` → 4 điều kiện (tồn tại, đúng chủ, trạng thái `PAID|FULFILLING|SHIPPED|DELIVERED|COMPLETED`, chứa `productId`) → lưu. Unique `(userId, productId, orderId)` làm lớp chống review trùng ở DB (message do `ReviewRpcExceptionFilter` quy định). Phụ thuộc runtime vào Orders (Orders down ⇒ không review được). Không cập nhật rating tổng hợp lên Product.

---

## 8. Promotion Service (`apps/promotion`, :3007 + Kafka consumer) — CQRS

`CreateVoucher` (unique `code`), `ApplyVoucher` (cũ: transaction + `pessimistic_write` lock, tiêu lượt ngay, không gắn đơn), `GetVouchers`, `GetAvailableVouchers` (lọc `usageCount < usageLimit` **ở tầng ứng dụng** sau khi query `expiresAt > now`).
Luồng checkout (TCP, Orders gọi): `VALIDATE_VOUCHER` (query, không ghi) · `RESERVE_VOUCHER` (1 TX, `FOR UPDATE` voucher, `usageCount += 1`, insert `voucher_redemptions` `RESERVED`, idempotent theo `orderId`) · `RELEASE_VOUCHER` (`RESERVED → RELEASED`, `usageCount -= 1`, kẹp ≥ 0). Kafka `order-events` (group `promotion-service`, inbox): `OrderPaid` → `CONFIRMED` (một `UPDATE ... WHERE orderId AND status='RESERVED'`); `OrderCancelled{paid:false}` → release; `paid:true` hoặc thiếu cờ → bỏ qua (an toàn hơn trả nhầm lượt). Thứ tự khoá luôn voucher → redemption.
Công thức/kiểm tra ở `domain/voucher-rules.ts` (404 → hết hạn → hết lượt → `orderValue < minOrderValue`; PERCENTAGE `round2(v×value/100)`, FIXED `min(value, orderValue)`); `orderValue` là subtotal.
Code voucher **phân biệt hoa thường**. Không có `isActive`, không giới hạn theo user/sản phẩm/danh mục. Migration `AddVoucherRedemptions` chưa chạy trên DB thật.

### 8a. Inventory Service (`apps/inventory`, :3008 + Kafka) — CQRS
Sở hữu `stock_items(productId, variantId?, onHand, reserved)` (unique `NULLS NOT DISTINCT`, CHECK `reserved >= 0 AND onHand >= reserved`) và `reservations(orderId unique, items jsonb, status RESERVED|COMMITTED|RELEASED|EXPIRED|RESTOCKED, expiresAt)`; `available = onHand − reserved`.
- TCP: `RESERVE` (1 TX; khoá `replaces` + mọi `stock_items` liên quan bằng một câu `ORDER BY id FOR UPDATE` → không deadlock; kiểm đủ hàng TRƯỚC khi ghi, thiếu → 409 kèm `productIds`; trả phần đơn cũ, tăng `reserved`; idempotent theo `orderId`), `CHECK_RESERVATION` (`valid = RESERVED && now < expiresAt`), `RELEASE`, `ADJUST_STOCK` (upsert; `onHand + delta < reserved|0` → 409), `GET_AVAILABILITY` (≤ 200 id; thiếu dòng = 0).
- Kafka `inventory-commands` (group `inventory-service`, key orderId): `CommitInventory` (RESERVED → COMMITTED, trừ `onHand`/`reserved`; phát `InventoryCommitted`; đã COMMITTED → phát lại; RELEASED/EXPIRED/RESTOCKED/không có → `InventoryCommitFailed{reason}`), `ReleaseInventory` (chỉ khi RESERVED), `RestockInventory` (COMMITTED → cộng lại `onHand`, RESTOCKED; RESERVED → chỉ release; idempotent).
- Job hết hạn (`@Cron`, `INVENTORY_EXPIRY_GRACE_SECONDS`): reservation `RESERVED` quá `expiresAt` → `EXPIRED` + trả `reserved` (batch 100, mỗi reservation 1 TX, `SKIP LOCKED`) — lưới an toàn khi Orders crash.
- Chưa kiểm chứng trên Postgres thật: SQL `unnest(...)` với mảng chứa NULL, `FOR UPDATE OF s` + JOIN unnest, `ON CONFLICT` với unique index NULLS NOT DISTINCT.

### 8b. Shipping Service (`apps/shipping`, :3009 + Kafka) — CQRS
Sở hữu `shipments(orderId unique, status CREATED|DELIVERED|CANCELLED|FAILED, trackingCode, ...)`. Kafka `shipping-commands` (group `shipping-service`): `CreateShipment` (chưa có → carrier mô phỏng → `CREATED` + `ShipmentCreated{trackingCode}`; đã có → no-op; lỗi 3 lần → DLQ + TX riêng insert `FAILED` + `ShipmentFailed{reason}`), `CancelShipment` (khoá dòng `pessimistic_write`; `CREATED` → `CANCELLED`; khác → no-op). TCP: `HANDLE_WEBHOOK {payload, signature}` (HMAC `SHIPPING_WEBHOOK_SECRET`, kiểm schema + `trackingCode` khớp; `CREATED` → `DELIVERED` + `ShipmentDelivered{deliveredAt}`; đã huỷ → no-op), `SIMULATE_DELIVERY {orderId}` (production → 404), `GET_SHIPMENT`. Hẹn giờ giao `SHIPPING_SIM_DELIVER_DELAY_MS>0` (đặt sau commit, mất khi restart); `SHIPPING_SIM_MODE=fail` để thử DLQ. Chưa kiểm chứng trên Postgres/Kafka thật.

---

## 9. Shared libs

| Lib | Nội dung & hành vi |
|---|---|
| `libs/common` | `CommonConfigModule` + `validateEnv`, `AbstractRpcExceptionFilter`, `PaginationQueryDto`/`PaginatedResult`, `setupTracing`; `constant/cmd.ts` là bản **trùng/cũ** của `GET_USER_INFO` (vẫn được User/Notification dùng → chưa xoá được ngay) |
| `libs/database` | `DatabaseModule`, `data-source.ts` (CLI), migrations (…, `AddKafkaOutboxAndInbox`, `AddOrderLifecycleColumns`, `AddInventoryTables`, `AddPaymentIntentAndRefund`, `AddShipments`, `AddVoucherRedemptions`, `FinalizeOrderStatusAndStockOwnership`) |
| `libs/cached` | `CachedModule`/`CachedService` (`get/set(ttl)/del`) trên `ioredis`, `RedisHealthIndicator` |
| `libs/media` | `MediaService` (MinIO): `ensureBucketExists`, `uploadFile`, `getPresignedUrl` |
| `libs/messaging` | Kafka: `MessagingModule.forService({source, relay?})`, `OutboxWriter`, `OutboxRelayService`, `InboxService`, `KafkaConsumerRunner`, `KafkaProducerService`, envelope, `ensureKafkaTopics` (xem §0.3a) |
| `libs/constant` | `PORT_TCP`, `NAME_SERVICE_TCP`, `*_MESSAGE_PATTERN`, `kafka.constant.ts` (topic, message type, consumer group, outbox source), `Action/ModuleName` (permission bitmask) |

---

## 10. Health & vận hành
Mỗi microservice có `HealthController` (`cmd: health_check`, Terminus ping DB; User thêm ping Redis); Gateway `GET /health` kiểm tra Redis + 3 service (user, product, order) — payment/notification/review/promotion/inventory/shipping và Kafka **chưa** nằm trong health tổng hợp. Graceful shutdown bằng `enableShutdownHooks()`. Seed dữ liệu lớn: `npm run seed` (`scripts/seed.ts`: ~50.000 product kèm `stock_items`, 20.000 order phân bố theo state machine mới, 2.000 user, xuất CSV tài khoản, mật khẩu `Password123`; chưa chạy sau thay đổi cutover).
