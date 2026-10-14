# Business Flows & Business Rules

**Ngày cập nhật**: 2026-10-05
**Nguồn**: đối chiếu trực tiếp với code (`apps/*`, `libs/*`) — không dựa vào tài liệu cũ.

Tài liệu mô tả **luồng nghiệp vụ end-to-end** (nhiều service phối hợp) và **business rules** đang được code thực thi. Chi tiết xử lý bên trong từng service xem [module-processing-flows.md](./module-processing-flows.md). Các lựa chọn thiết kế và đánh đổi xem [design-trade-offs.md](./design-trade-offs.md).

> Quy ước: **[ĐÃ CÓ]** = code đang thực thi; **[CHƯA CÓ]** = nghiệp vụ mong đợi nhưng code chưa làm (ghi rõ để tránh hiểu nhầm).

---

## 1. Bản đồ nghiệp vụ

| Domain | Service | Dữ liệu chính | Lưu ở |
|---|---|---|---|
| Danh tính & phân quyền | `user` (:3001) | User, Role, UserRole, Address | PostgreSQL + Redis (session) |
| Danh mục & tồn kho | `product` (:3003) | Product, Category, Brand, Attribute, Variant | PostgreSQL |
| Giỏ hàng, đơn hàng, hoàn tiền | `orders` (:3002) | Cart (Redis), Order, OrderItem, Refund, Outbox | Redis + PostgreSQL |
| Thanh toán | `payment` (:3004) | PaymentTransaction, PaymentWebhookLog | PostgreSQL |
| Thông báo | `notification` (:3005) | SentNotification | PostgreSQL |
| Đánh giá | `review` (:3006) | Review | PostgreSQL |
| Khuyến mãi | `promotion` (:3007) | Voucher | PostgreSQL |
| Cổng vào | `gateway` (:3000) | — (stateless; rate-limit & idempotency ở Redis) | Redis |

Tất cả service dùng chung **1 database PostgreSQL** (`ecommerce`) và **1 bộ migration** (`libs/database/src/migrations`), nhưng mỗi service chỉ đọc/ghi bảng của mình; liên kết giữa domain là **UUID tham chiếu mềm** (không FK chéo service), xem trade-off #3.

---

## 2. Luồng nghiệp vụ end-to-end

### 2.1 Đăng ký → Đăng nhập → Gọi API có xác thực

```
Client ── POST /user/register ──▶ Gateway (throttle 5/phút/IP) ──TCP──▶ User.register
          └ email trùng → 409; bcrypt(10) mật khẩu; lưu User (permissions=0, isActive=true)

Client ── POST /user/login ────▶ Gateway (throttle 5/phút/IP) ──TCP──▶ User.login
          └ sai email/mật khẩu → 401 "Invalid credentials" (cùng 1 message, không lộ email tồn tại)
          └ tạo sessionId (uuid) → ký accessToken (15m) + refreshToken (7d), payload {sub,email,sessionId}
          └ Redis SET refresh_token:{userId}:{sessionId} = refreshToken  (TTL 7 ngày)
          └ trả {accessToken, refreshToken, sessionId, user{id,email,fullName}}

Client ── GET/POST ... + Authorization: Bearer <accessToken> ──▶ Gateway
          └ JwtAuthGuard → TCP User.VERIFY_TOKEN (timeout 5s):
               1) verify chữ ký + hạn access token
               2) Redis GET refresh_token:{sub}:{sessionId} — không có = session đã bị thu hồi → 401
               3) đọc lại User từ DB, !isActive → 401
               4) permissions = OR bitmask các Role của user (fallback User.permissions nếu chưa có role)
          └ gắn req.user = {userId,email,fullName,permissions,sessionId}
          └ PermissionGuard so (permissions & required) === required → không đủ = 403

Client ── POST /user/logout {userId,sessionId} ──▶ Redis DEL refresh_token:{userId}:{sessionId}
          └ access token còn hạn nhưng VERIFY_TOKEN sẽ fail vì session key đã mất (≤ 0 độ trễ)
```

**Business rules**
- Email là duy nhất (`users.email unique`). Mật khẩu luôn lưu dạng bcrypt.
- Một user có thể có **nhiều session đồng thời** (mỗi lần login = 1 `sessionId` riêng); logout chỉ huỷ session được chỉ định.
- Thu hồi quyền có hiệu lực **ngay** vì `permissions` được tính lại ở mỗi request (không nhét vào JWT).
- **[CHƯA CÓ]** endpoint refresh token — `refreshToken` chỉ được lưu để làm "khoá session"; access token hết hạn sau 15 phút thì user phải login lại.
- **[CHƯA CÓ]** user mặc định có quyền: `register` tạo user với `permissions=0` và **không tự gán role** → phải gán Role thủ công qua `POST /roles/assign` trước khi gọi được API cần quyền.

### 2.2 Phân quyền RBAC bitmask

`libs/constant/permission.constant.ts`

| Action | bit | Module | bit |
|---|---|---|---|
| CREATE | 1 | USER | 16 |
| READ | 2 | PRODUCT | 32 |
| UPDATE | 4 | ORDER | 64 |
| DELETE | 8 | CAMPAIGN | 128 (chưa dùng) |
| ALL | 15 | PAYMENT | 256 |
| | | REVIEW | 512 |
| | | PROMOTION | 1024 |

- Quyền yêu cầu của route = `Module | Action` (vd `PRODUCT|UPDATE` = 36), khai báo bằng `@RequirePermission(Module, Action...)`.
- Quyền hiệu lực của user = `OR` mọi role. Kiểm tra: `(userPerm & required) === required` (phải có **đủ mọi bit**).
- Seed role "Customer" (`scripts/seed.ts`): `PRODUCT|READ`, `ORDER|CREATE|READ`, `PAYMENT|READ`, `REVIEW|CREATE|READ`, `PROMOTION|READ`.

### 2.3 Quản lý catalog (Admin)

```
Admin(PRODUCT|CREATE) ─▶ POST /products ─▶ Product.CreateProduct
   ├ category phải tồn tại (404), brand (nếu có) phải tồn tại (404)
   ├ slug unique (DB) ; price ≥ 0, stock ≥ 0
   ├ lưu Product, publish ProductCreatedEvent lên EventBus nội bộ (hiện chỉ console.log — stub cho Elasticsearch)
Admin ─▶ POST /products/:id/images (multipart) ─▶ Gateway upload MinIO (bucket chung, path products/{uuid}-{tên})
         └ đọc product → append path vào mảng images → UpdateProduct (không phải 1 transaction)
Admin ─▶ Brand / Attribute / Variant CRUD (Product service)
   ├ Variant: sku unique (409), phải gắn ≥ các AttributeValue hợp lệ (404 nếu thiếu), giá riêng tuỳ chọn (null = dùng giá product)
   └ Xoá: Product = hard delete (`remove`), Variant = soft delete (`softRemove`), Brand/Attribute = hard delete
```

**Rules**: `getProducts` hỗ trợ lọc category/brand/giá/isActive/search (ILIKE tên), sort chỉ trong whitelist `name|price|stock|createdAt`, phân trang mặc định page=1, limit=20.

### 2.4 Giỏ hàng → Checkout → Đơn hàng (luồng trọng tâm)

```
Client ─ POST /cart/items {productId, quantity≥1} ─▶ Orders.Cart (Redis key cart:{userId}, TTL 30 ngày)
        └ addItem: cùng productId → CỘNG dồn quantity; updateItem: GHI ĐÈ quantity; removeItem; clear
        └ Cart chỉ lưu {productId, quantity} — KHÔNG lưu giá, KHÔNG kiểm tra tồn tại/tồn kho lúc thêm

Client ─ POST /cart/checkout {shippingAddress} ─▶ Gateway.CartController.checkout
  1) lấy cart; rỗng → 400 "Cart is empty"
  2) với mỗi item: gọi Product.GET_PRODUCT → unitPrice = giá HIỆN TẠI (snapshot); product không tồn tại → 400
  3) Orders.CreateOrder  ──────────────────────────────────────────────┐
  4) thành công → clearCart(userId) → trả order                         │
                                                                         ▼
Orders.CreateOrderHandler (Saga điều phối, không có transaction bao trùm)
  subtotal = Σ qty×unitPrice ; tax = round(subtotal × ORDER_TAX_RATE[0.1], 2) ; ship = ORDER_SHIPPING_FEE_FLAT[30000]
  total = subtotal + tax + ship
  S1  Reserve:  với mỗi item gọi Product.ADJUST_STOCK(delta = -qty)
        └ 1 item fail giữa chừng ⇒ hoàn (delta=+qty) các item đã trừ trước đó, ném lỗi gốc (409 "Không đủ tồn kho"…)
  S2  Tx#1: INSERT Order(status=PENDING) + OrderItems (snapshot địa chỉ giao hàng, giá)
  S3  Capture: Payment.CHARGE_PAYMENT {orderId, amount, idempotencyKey=orderId}  (timeout 10s)
        ├ success=false HOẶC lỗi TCP/timeout (đã bắt, quy về "Payment service unavailable")
        │   ⇒ Compensation: release stock (best-effort, lỗi chỉ log) + Order=CANCELLED ⇒ HTTP 402
        └ success ⇒ S4
  S4  Tx#2: Order=PROCESSING + INSERT Outbox('order.created', {orderId,userId,totalAmount}) → trả Order
Sau commit: OutboxWorker (mỗi 1s) fan-out event → Notification gửi email.
```

**Business rules**
- **Giá**: luôn là snapshot tại thời điểm tạo đơn (`order_items.unit_price`), thay đổi giá product sau đó không ảnh hưởng đơn cũ.
- **Phí**: thuế 10% (`ORDER_TAX_RATE`) tính trên subtotal; phí ship cố định 30.000 (`ORDER_SHIPPING_FEE_FLAT`); cả hai đọc từ ConfigService. Chưa có logic ship theo vùng/cân nặng.
- **Địa chỉ giao hàng** được copy (denormalize) vào `orders` — đổi/xoá Address Book của user không làm đổi đơn cũ.
- **Tồn kho** bị trừ **ngay** ở S1 (không có khái niệm "giữ chỗ" riêng); đơn `PENDING/PROCESSING` đã chiếm kho.
- **Idempotency thanh toán**: key = `orderId` → Payment trả lại kết quả cũ nếu gọi lặp, không charge 2 lần.
- **[CHƯA CÓ]** Voucher **chưa được tích hợp** vào checkout: `total` không trừ giảm giá; `POST /vouchers/apply` là API tính toán độc lập (xem 2.8).
- **[CHƯA CÓ]** `POST /orders` (Gateway) nhận thẳng `userId` + `unitPrice` từ client — chỉ `/cart/checkout` mới lấy giá server-side. Xem rủi ro ở [design-trade-offs.md §5](./design-trade-offs.md#5-rủi-ro--gap-đã-xác-minh-trong-code).

### 2.5 Vòng đời đơn hàng (state machine)

`apps/orders/src/order-status.constant.ts`

```
PENDING ──▶ PROCESSING ──▶ PAID ──▶ SHIPPED ──▶ DELIVERED ──▶ REFUNDED
   │            │            │
   └────────────┴────────────┴──▶ CANCELLED          (CANCELLED, REFUNDED là trạng thái cuối)
```

| Từ | Được chuyển tới |
|---|---|
| PENDING | PROCESSING, CANCELLED |
| PROCESSING | PAID, CANCELLED |
| PAID | SHIPPED, CANCELLED |
| SHIPPED | DELIVERED |
| DELIVERED | REFUNDED |
| CANCELLED / REFUNDED | — |

- Chuyển trạng thái thủ công: `PATCH /orders/:id/status` (`ORDER|UPDATE`). Chuyển sai luồng → 400 `Không thể chuyển trạng thái từ X sang Y`.
- Mỗi lần chuyển: trong **cùng 1 transaction** lưu Order + ghi Outbox `order.status_updated {orderId,userId,previousStatus,status}`.
- Checkout tự động đưa đơn `PENDING → PROCESSING`. Sự kiện `payment_succeeded` do Payment emit được Orders nhận (`PaymentEventsController`) và tự chuyển `PROCESSING → PAID` (kèm Outbox `order.status_updated` nên Notification gửi thêm mail). Event có thể tới khi đơn còn `PENDING` nên handler chờ thử lại ngắn; nếu vẫn không kịp, đơn ở `PROCESSING` và admin PATCH thủ công.
- **Lưu ý**: Cancel thủ công (`→ CANCELLED`) **không** hoàn kho và **không** hoàn tiền (chỉ checkout-fail mới có compensation).

### 2.6 Hoàn tiền (Refund)

```
Customer/Admin(ORDER|CREATE) ─ POST /refunds {orderId, amount≥0.01, reason}
   ├ order không tồn tại → 404
   ├ order.status ∉ {PAID, SHIPPED, DELIVERED} → 400
   ├ Σ(refund không phải REJECTED) + amount > order.totalAmount → 400 "vượt quá tổng giá trị đơn hàng"
   └ tạo Refund(PENDING)

Admin(ORDER|UPDATE) ─ POST /refunds/:id/approve  (1 transaction)
   ├ refund phải PENDING (404/400)
   ├ refund → COMPLETED
   └ nếu Σ(COMPLETED + refund này) ≥ order.totalAmount VÀ canTransition(order.status, REFUNDED)
        → Order = REFUNDED   (chỉ hợp lệ khi order đang DELIVERED)
Admin ─ POST /refunds/:id/reject → refund PENDING → REJECTED
```

- Cho phép **hoàn một phần nhiều lần**, tổng không vượt `totalAmount`.
- Enum có `APPROVED` nhưng code đi thẳng `PENDING → COMPLETED` (không có bước APPROVED riêng).
- **[CHƯA CÓ]** Hoàn tiền thật qua provider, hoàn kho, và không tự `REFUNDED` khi order đang PAID/SHIPPED dù hoàn đủ. Approve chỉ cập nhật sổ sách.

### 2.7 Thanh toán & Webhook

```
(Nội bộ) Orders ─TCP─▶ Payment.CHARGE_PAYMENT
   ├ tìm PaymentTransaction theo idempotencyKey → có rồi: trả kết quả đã lưu (không gọi provider)
   ├ provider.charge(orderId, amount)  (hiện: SimulatedPaymentProvider luôn success, transactionId "SIMULATED-{orderId}")
   ├ lưu PaymentTransaction(SUCCEEDED|FAILED, failureReason)
   └ emit payment_succeeded | payment_failed → Orders (`PaymentEventsController`)

(Ngoài) Provider ─ POST /webhooks/payments {payload, signature} ─▶ Gateway (KHÔNG JwtAuth) ─▶ Payment.HANDLE_WEBHOOK
   ├ verifyWebhook: HMAC-SHA256(JSON.stringify(payload), PAYMENT_WEBHOOK_SECRET) so với signature → sai = 400
   ├ eventId đã có trong payment_webhook_logs → trả {processed:false, alreadyProcessed:true}
   └ chưa có → ghi log eventId (+orderId) → {processed:true}
```

- Webhook hiện **chỉ ghi nhận + khử trùng**, chưa cập nhật Order/Transaction.
- `GET /payments/:orderId/transaction` (`PAYMENT|READ`) trả giao dịch mới nhất của đơn.

### 2.8 Voucher

```
Admin(PROMOTION|CREATE) ─ POST /vouchers {code, discountType PERCENTAGE|FIXED, discountValue>0, minOrderValue≥0, expiresAt, usageLimit>0}
   └ code unique → trùng: 409 "Voucher with this code already exists"
User(PROMOTION|READ) ─ POST /vouchers/apply {code, orderValue>0}  (1 transaction, SELECT … FOR UPDATE)
   ├ không có → 404 ; hết hạn → 400 ; usageCount ≥ usageLimit → 400 ; orderValue < minOrderValue → 400
   ├ PERCENTAGE: discount = round2(orderValue × value/100)   |   FIXED: min(value, orderValue)
   ├ usageCount += 1  (tiêu thụ lượt NGAY khi apply)
   └ trả {code, discountAmount, finalAmount = orderValue - discount}
GET /vouchers/available → voucher chưa hết hạn và còn lượt
```

- **Không gắn user**: 1 user có thể apply lặp nhiều lần (mỗi lần tốn 1 lượt) — chỉ giới hạn bằng `usageLimit` toàn cục.
- Lượt dùng **không được hoàn** nếu đơn sau đó bị huỷ hoặc không bao giờ tạo (vì chưa nối với checkout).

### 2.9 Đánh giá sản phẩm

```
User(REVIEW|CREATE) ─ POST /reviews {userId, productId, orderId, rating 1..5, comment?}
   └ Review service gọi Orders.GET_ORDER(orderId) qua TCP rồi kiểm tra:
        order tồn tại (404) VÀ order.userId == userId VÀ order.status ∈ {PAID,SHIPPED,DELIVERED} VÀ order.items chứa productId
        sai bất kỳ điều kiện → 403 "Chỉ có thể review sản phẩm đã mua trong đơn hàng hợp lệ"
   └ unique (userId, productId, orderId) → review lần 2 cho cùng cặp → "You have already reviewed this product for this order"
GET /reviews/product/:productId → danh sách mới nhất trước (không phân trang, không tính điểm trung bình)
```

- Rule "đã mua" = đơn thuộc user + đã thanh toán + chứa sản phẩm. `REFUNDED`/`CANCELLED` **không** được review.
- `userId` lấy từ body chứ không từ JWT (xem rủi ro §5 của trade-offs).

### 2.10 Thông báo theo sự kiện đơn hàng

```
OutboxWorker (Orders) ── emit 'order.created' / 'order.status_updated' ──▶ Notification (EventPattern)
   ├ gọi User.GET_USER_INFO(userId) lấy email; lỗi → fallback dùng userId làm recipient (log warn)
   ├ EmailProvider.send (Simulated: chỉ log)
   └ ghi sent_notifications {channel=EMAIL, recipient, subject, body, status SENT|FAILED, sourceEvent}
Admin ─ (TCP) GET_SENT_NOTIFICATIONS {recipient?} → lịch sử gửi  [chưa có route Gateway tương ứng]
```

- Push (`PushProvider`) đã đăng ký DI nhưng **chưa có handler gọi**.
- Nội dung email là chuỗi cứng (tiếng Việt), chưa có template.

### 2.11 Upload media

`POST /user/me/avatar` và `POST /products/:id/images` (multipart `file`) → `MediaService.uploadFile` đưa lên MinIO với object name `{folder}/{uuid}-{originalname}`; DB chỉ lưu **object path** (không lưu URL). `getPresignedUrl` (mặc định 1 giờ) dùng khi cần hiển thị. Chưa có kiểm tra loại/dung lượng file ở tầng code.

---

## 3. Bảng tổng hợp business rules theo mã lỗi

| Tình huống | Service | HTTP |
|---|---|---|
| Email đã tồn tại | user | 409 |
| Sai thông tin đăng nhập / session bị thu hồi / user inactive | user→gateway | 401 |
| Thiếu quyền bitmask | gateway | 403 |
| Thiếu/sai `x-api-key` | gateway | 401 |
| Vượt rate limit | gateway | 429 |
| Slug brand / SKU / attribute trùng | product | 409 |
| Không đủ tồn kho / stock đang bị cập nhật đồng thời (sau 1 lần retry) | product | 409 |
| Cart rỗng khi checkout | gateway | 400 |
| Thanh toán thất bại / Payment service không phản hồi | orders | 402 |
| Chuyển trạng thái đơn không hợp lệ | orders | 400 |
| Refund sai trạng thái đơn / vượt tổng tiền | orders | 400 |
| Review sản phẩm chưa mua | review | 403 |
| Voucher hết hạn / hết lượt / chưa đủ giá trị tối thiểu | promotion | 400 |
| Request trùng `x-idempotency-key` đang xử lý | gateway | 409 |
| Webhook sai chữ ký | payment | 400 |

---

## 4. Tài liệu liên quan

- [module-processing-flows.md](./module-processing-flows.md) — xử lý chi tiết từng module
- [design-trade-offs.md](./design-trade-offs.md) — quyết định thiết kế, đánh đổi, gap
- [system-architecture.md](./system-architecture.md) — kiến trúc tổng thể
- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) — Saga/Outbox chi tiết
