# Business Flows & Business Rules

**Ngày cập nhật**: 2026-10-15
**Nguồn**: đối chiếu trực tiếp với code (`apps/*`, `libs/*`) — không dựa vào tài liệu cũ.

Tài liệu mô tả **luồng nghiệp vụ end-to-end** (nhiều service phối hợp) và **business rules** đang được code thực thi. Chi tiết xử lý bên trong từng service xem [module-processing-flows.md](./module-processing-flows.md). Các lựa chọn thiết kế và đánh đổi xem [design-trade-offs.md](./design-trade-offs.md).

> Luồng checkout/state machine dưới đây là **checkout v2 event-driven** (đã cutover, Saga đồng bộ cũ đã xoá). Thiết kế gốc + trạng thái triển khai: [target-checkout-architecture.md](./target-checkout-architecture.md).
>
> **Trạng thái kiểm chứng**: code + unit test (mock) + build đã xong; các luồng Postgres/Kafka thật (migration, int-spec, e2e) **chưa kiểm chứng trên stack thật** tại thời điểm viết.
>
> Quy ước: **[ĐÃ CÓ]** = code đang thực thi; **[CHƯA CÓ]** = nghiệp vụ mong đợi nhưng code chưa làm (ghi rõ để tránh hiểu nhầm).

---

## 1. Bản đồ nghiệp vụ

| Domain | Service | Dữ liệu chính | Lưu ở |
|---|---|---|---|
| Danh tính & phân quyền | `user` (:3001) | User, Role, UserRole, Address | PostgreSQL + Redis (session) |
| Danh mục sản phẩm | `product` (:3003) | Product, Category, Brand, Attribute, Variant (không còn tồn kho) | PostgreSQL |
| Tồn kho & giữ hàng | `inventory` (:3008) | StockItem, Reservation, Outbox, Inbox | PostgreSQL |
| Giỏ hàng, đơn hàng, hoàn hàng | `orders` (:3002) | Cart (Redis), Order, OrderItem, Refund, Outbox, Inbox | Redis + PostgreSQL |
| Thanh toán | `payment` (:3004) | PaymentTransaction (intent), PaymentWebhookLog, PaymentRefund, Outbox, Inbox | PostgreSQL |
| Vận chuyển | `shipping` (:3009) | Shipment, Outbox, Inbox | PostgreSQL |
| Thông báo | `notification` (:3005) | SentNotification, Inbox | PostgreSQL |
| Đánh giá | `review` (:3006) | Review | PostgreSQL |
| Khuyến mãi | `promotion` (:3007) | Voucher, VoucherRedemption, Inbox | PostgreSQL |
| Cổng vào | `gateway` (:3000) | — (stateless; rate-limit & idempotency ở Redis) | Redis |

Giao tiếp: RPC đồng bộ qua **TCP**, event/command bất đồng bộ qua **Kafka** (Outbox → relay at-least-once → Inbox, xem [system-architecture.md](./system-architecture.md)).

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
   ├ slug unique (DB) ; price ≥ 0 (tồn kho không nằm ở Product — nhập bằng `POST /products/:id/stock-adjustments` → Inventory)
   ├ lưu Product, publish ProductCreatedEvent lên EventBus nội bộ (hiện chỉ console.log — stub cho Elasticsearch)
Admin ─▶ POST /products/:id/images (multipart) ─▶ Gateway upload MinIO (bucket chung, path products/{uuid}-{tên})
         └ đọc product → append path vào mảng images → UpdateProduct (không phải 1 transaction)
Admin ─▶ Brand / Attribute / Variant CRUD (Product service)
   ├ Variant: sku unique (409), phải gắn ≥ các AttributeValue hợp lệ (404 nếu thiếu), giá riêng tuỳ chọn (null = dùng giá product)
   └ Xoá: Product = hard delete (`remove`), Variant = soft delete (`softRemove`), Brand/Attribute = hard delete
```

**Rules**: `getProducts` hỗ trợ lọc category/brand/giá/isActive/search (ILIKE tên), sort chỉ trong whitelist `name|price|createdAt`, phân trang mặc định page=1, limit=20. Gateway ghép `available`/`stockStatus` (`IN_STOCK|OUT_OF_STOCK|UNKNOWN`) từ Inventory bằng đúng 1 lần gọi theo mảng id; Inventory lỗi/chậm (>1.5s) → `UNKNOWN`, không làm lỗi danh sách.

### 2.4 Giỏ hàng → Checkout v2 → Đơn hàng (luồng trọng tâm)

```
Client ─ POST /cart/items {productId, quantity≥1} ─▶ Orders.Cart (Redis key cart:{userId}, TTL 30 ngày)
        └ addItem: cùng productId → CỘNG dồn quantity; updateItem: GHI ĐÈ quantity; removeItem; clear
        └ Cart chỉ lưu {productId, quantity} — KHÔNG lưu giá, KHÔNG kiểm tra tồn tại/tồn kho lúc thêm

Client ─ POST /cart/checkout  (x-idempotency-key BẮT BUỘC)
         {items:[{productId}], shippingAddress, voucherCode?}  ─▶ Gateway ─TCP─▶ Orders.CheckoutHandler
   Body chỉ chứa định danh món được chọn; `userId`/`quantity`/`unitPrice` trong body → 400 (forbidNonWhitelisted).
   userId lấy từ token; số lượng lấy từ cart; giá lấy từ Product (server-side); `variantId` → 400 (chưa hỗ trợ).
  1) Pricing: mọi món phải có trong cart (không thì 400), không trùng productId; subtotal = Σ qty×giá;
     tax = round(subtotal×ORDER_TAX_RATE[0.1]); ship = ORDER_SHIPPING_FEE_FLAT[30000];
     có voucherCode → Promotion.VALIDATE_VOUCHER(subtotal) → discount; total = subtotal + tax + ship − discount
  2) Inventory.RESERVE(orderId, items, ttl=ORDER_PAYMENT_TTL_SECONDS[900], replaces=[đơn PENDING_PAYMENT cũ có món trùng])
       hết hàng → 409, dừng (chưa có gì để hoàn). Reserve atomic toàn bộ hoặc không món nào.
  3) Promotion.RESERVE_VOUCHER(code, orderId, userId, subtotal) — sau reserve kho; lỗi → Inventory.RELEASE + lỗi gốc
  4) TX Orders: INSERT Order(PENDING_PAYMENT, expiresAt, voucherCode, discountAmount) + items + Outbox(OrderCreated);
       huỷ các đơn `replaces` (CANCELLED/REPLACED + CancelPaymentIntent + OrderCancelled{paid:false})
       TX lỗi → Inventory.RELEASE + RELEASE_VOUCHER best-effort
  5) Chốt #1: Inventory.CHECK_RESERVATION phải valid; không đạt → huỷ đơn (CANCELLED/RESERVATION_INVALID), 409, không tạo intent
  6) Payment.CREATE_INTENT(orderId, amount=total, idempotencyKey=orderId, expiresAt=hạn giữ hàng) → checkoutUrl
       lỗi/timeout → đơn vẫn PENDING_PAYMENT (chỉ log); user lấy lại link bằng GET /orders/:id/pay
  7) KHÔNG xoá cart. Trả 201 {orderId, status:'PENDING_PAYMENT', payment_url, expiresAt}
       payment_url = ${PUBLIC_API_BASE_URL}/orders/{id}/pay   (endpoint cần JWT → client tự gọi, nhận {paymentUrl, expiresAt})
```

**Sau khi có `payment_url`** (chốt #2 + thanh toán + fulfillment, bất đồng bộ qua Kafka):

```
GET /orders/:id/pay (chốt #2): chủ đơn (khác → 404), PENDING_PAYMENT, chưa quá expiresAt, reservation còn RESERVED → {paymentUrl, expiresAt}
                               không đạt → huỷ đơn nếu cần + 409 "Hết hàng hoặc hết hạn giữ hàng"
Cổng TT (simulator) ─ POST /webhooks/payments (HMAC) ─▶ Payment: TX payment=SUCCEEDED + outbox PaymentSucceeded
  └ payment-events ▶ Orders: PENDING_PAYMENT→PAID; outbox OrderPaid + CommitInventory; trừ cart đúng món đã đặt
      └ inventory-commands ▶ Inventory: RESERVED→COMMITTED, trừ onHand; outbox InventoryCommitted
          └ inventory-events ▶ Orders: PAID→FULFILLING; outbox CreateShipment
              └ shipping-commands ▶ Shipping: carrier mô phỏng → trackingCode; outbox ShipmentCreated
                  └ shipping-events ▶ Orders: FULFILLING→SHIPPED
Webhook giao hàng (POST /webhooks/shipping, HMAC; hoặc admin POST /shipments/:orderId/deliver) ▶ Shipping: ShipmentDelivered
  └ Orders: SHIPPED→DELIVERED (deliveredAt); scheduler: DELIVERED quá ORDER_RETURN_WINDOW_DAYS[7] → COMPLETED
Phụ: OrderPaid → Promotion confirm voucher; OrderStatusChanged → Notification gửi email theo trạng thái.
```

**Business rules**
- **Giá**: snapshot tại thời điểm tạo đơn (`order_items.unit_price`); thay đổi giá sau đó không ảnh hưởng đơn cũ. Server là nguồn của giá và số lượng — không bao giờ tin từ client.
- **Phí**: thuế 10% (`ORDER_TAX_RATE`) tính trên subtotal; ship cố định 30.000 (`ORDER_SHIPPING_FEE_FLAT`); cả hai đọc từ ConfigService.
- **Địa chỉ giao hàng** được copy (denormalize) vào `orders`.
- **Tồn kho**: reserve ≠ trừ thật. `available = onHand − reserved`. Reserve giữ hàng 15 phút (`reserved += q`); chỉ khi thanh toán thành công mới `CommitInventory` (`onHand −= q`, `reserved −= q`). Hết hạn/huỷ → release.
- **Chỉ thanh toán khi còn hàng**: 3 chốt — #1 sau khi tạo đơn (trước khi cấp intent), #2 lúc `GET /orders/:id/pay`, #3 `expiresAt` của intent = hạn reservation (không dài hơn). Khoảng hở (trả sát giờ, webhook tới sau khi đơn đã `CANCELLED`) → tự hoàn toàn bộ số đã thu.
- **Cart**: giữ nguyên khi checkout / huỷ / hết hạn / thanh toán lỗi; chỉ trừ đúng món + số lượng đã đặt khi `PAID` (phần dư và món không chọn được giữ). Lỗi trừ cart chỉ log.
- **Checkout lại khi đã có đơn chờ**: luôn tạo đơn mới; đơn `PENDING_PAYMENT` cũ có **bất kỳ** món trùng bị huỷ toàn bộ (`REPLACED`, trả phần giữ trong cùng transaction reserve); đơn cũ không trùng món thì không đụng. Đơn không sửa item sau khi tạo.
- **Idempotency**: Gateway bắt buộc `x-idempotency-key` cho checkout (thiếu → 400; Redis lỗi → 503 fail-closed; key scope theo user + path; replay trả response đã cache); Payment idempotent theo `orderId` (createIntent, refund); Kafka consumer idempotent theo `eventId` (Inbox) và theo trạng thái đơn.
- **Voucher**: giữ lượt lúc checkout (`usageCount += 1`, redemption `RESERVED`); `OrderPaid` → `CONFIRMED`; `OrderCancelled{paid:false}` (hết hạn, `PaymentFailed`, `REPLACED`, huỷ khi chưa thanh toán) → `RELEASED`, trả lượt. Đơn đã thanh toán rồi huỷ/hoàn thì **không** trả lượt.

### 2.5 Vòng đời đơn hàng (state machine)

`apps/orders/src/order-status.constant.ts`

```
PENDING_PAYMENT ──▶ PAID ──▶ FULFILLING ──▶ SHIPPED ──▶ DELIVERED ──▶ COMPLETED
      │               │           │                         │
      └───────────────┴───────────┴──▶ CANCELLED            └──▶ REFUNDING ──▶ REFUNDED
```

| Từ | Sang | Trigger |
|---|---|---|
| PENDING_PAYMENT | PAID | `PaymentSucceeded` |
| PENDING_PAYMENT | CANCELLED | user huỷ (`USER`) / hết 15' (`PAYMENT_EXPIRED`) / `PaymentFailed` (`PAYMENT_FAILED`) / bị thay bởi checkout mới (`REPLACED`) / chốt #1-#2 thấy hết hàng (`RESERVATION_INVALID`) |
| PAID | FULFILLING | `InventoryCommitted` |
| PAID, FULFILLING | CANCELLED | user huỷ (`USER`); `InventoryCommitFailed` (`INVENTORY_COMMIT_FAILED`); `ShipmentFailed` (`SHIPMENT_FAILED`, chỉ từ FULFILLING) |
| FULFILLING | SHIPPED | `ShipmentCreated` |
| SHIPPED | DELIVERED | `ShipmentDelivered` |
| DELIVERED | REFUNDING | user hoàn hàng, trong 7 ngày kể từ `deliveredAt` |
| DELIVERED | COMPLETED | scheduler 10 phút/lần, quá cửa sổ đổi trả (đơn `REFUNDING` không bị đụng) |
| REFUNDING | REFUNDED | `PaymentRefunded` |

Terminal: `CANCELLED`, `REFUNDED`, `COMPLETED`. `SHIPPED`/`DELIVERED` không huỷ được; `COMPLETED` không hoàn hàng được (400).

- **Mọi** đổi trạng thái qua `OrderTransitionService`: `canTransition` + `UPDATE ... WHERE id AND version` + Outbox (`OrderStatusChanged` + event/command kèm theo) **cùng 1 transaction**. Lệch version = thua race: user → **409** "Đơn vừa thay đổi, hãy tải lại"; consumer Kafka → rollback, retry, đọc lại đơn rồi quyết định tiếp; scheduler → bỏ qua, lần sau quét lại.
- Race huỷ vs `ShipmentCreated` ở `FULFILLING`: bên cập nhật trước thắng. Huỷ thắng → `CANCELLED`, `ShipmentCreated` tới sau → Orders gửi `CancelShipment`. `ShipmentCreated` thắng → `SHIPPED`, huỷ bị 409.
- Race huỷ vs `CommitInventory` ở `PAID`: `RestockInventory` cùng partition key `orderId` với `CommitInventory` nên Inventory xử lý đúng thứ tự (commit trước → restock cộng lại; reservation còn `RESERVED` → restock chỉ release). `InventoryCommitted` tới đơn đã `CANCELLED` thì bỏ qua, không tạo shipment.
- **Huỷ**: `POST /orders/:id/cancel` — `PENDING_PAYMENT`: release kho, huỷ intent, không hoàn tiền; `PAID`/`FULFILLING`: `refundStatus=PENDING`, hoàn `total − phí ship`, restock (và `CancelShipment` nếu `FULFILLING`). `refundStatus` (`NONE|PENDING|SUCCEEDED|FAILED`) chỉ để hiển thị, cập nhật khi Payment báo `PaymentRefunded`/`PaymentRefundFailed` (kèm `refundedAmount`, `refundedAt`); `FAILED` cần admin xử lý tay.
- **Dữ liệu cũ khi cutover**: migration chuyển `PENDING`/`PROCESSING` → `PENDING_PAYMENT` với `expiresAt = now()` (scheduler huỷ ngay) — đơn `PROCESSING` cũ đã thu tiền sẽ bị huỷ **không hoàn tiền**; chấp nhận vì dữ liệu hiện chỉ là seed/dev.

### 2.6 Hoàn tiền

Số tiền hoàn luôn là `refundAmount = totalAmount − shippingFee` (= subtotal + tax − discount): **phí ship không hoàn**, voucher không trả. Payment nhận `amount` tường minh, mỗi đơn hoàn **tối đa 1 lần** (`payment_refunds.orderId` unique, hoàn cả đơn, không hoàn một phần).

| Luồng | Trigger | Kết quả |
|---|---|---|
| Huỷ khi đã thanh toán (`PAID`/`FULFILLING`) | `POST /orders/:id/cancel` | `CANCELLED` + `RefundPayment` + `RestockInventory`; `refundStatus` PENDING → SUCCEEDED/FAILED |
| Inventory commit lỗi | `InventoryCommitFailed` | `CANCELLED(INVENTORY_COMMIT_FAILED)` + `RefundPayment` (không restock vì kho chưa trừ) |
| Shipping lỗi vĩnh viễn (retry 3 → DLQ) | `ShipmentFailed` | `CANCELLED(SHIPMENT_FAILED)` + `RefundPayment` + `RestockInventory` |
| Thanh toán muộn vào đơn đã huỷ | `PaymentSucceeded` tới đơn `CANCELLED` | `refundStatus=PENDING` + `RefundPayment` **toàn bộ số đã thu** (đơn chưa từng PAID, không trừ ship — mặc định đã chọn, chưa có xác nhận riêng) |
| Hoàn hàng sau giao | `POST /orders/:id/return {reason}` (`DELIVERED`, trong 7 ngày) | `REFUNDING` + Refund `PENDING` + `RefundPayment`; `PaymentRefunded` → `REFUNDED` + Refund `COMPLETED` + `RestockInventory` (nhập kho ngay khi hoàn tiền xong, không theo dõi vận đơn trả về) |

- Payment replay refund đã có bản ghi: phát lại kết quả đã lưu (không gọi provider) với eventId mới → Orders xử lý idempotent theo trạng thái.
- `PaymentRefundFailed`: luồng huỷ → `refundStatus=FAILED` + log error; luồng hoàn hàng → đơn giữ `REFUNDING`, chỉ có log error (admin xử lý tay). Refund `FAILED` không retry được (unique `orderId`).
- Các endpoint refund cũ (`POST /refunds`, `/refunds/:id/approve|reject`, hoàn một phần nhiều lần) **đã bị xoá**; còn `GET /orders/:id/refunds` (đọc).

### 2.7 Thanh toán & Webhook

```
Orders ─TCP─▶ Payment.CREATE_INTENT {orderId, amount, idempotencyKey=orderId, expiresAt}
   ├ idempotencyKey đã có → trả intent cũ ở mọi trạng thái (không tạo mới)
   └ mới → INSERT intent PENDING (expiresAt = hạn giữ hàng), trả {intentId, status, checkoutUrl, expiresAt}
        checkoutUrl = ${PUBLIC_API_BASE_URL}/simulator/pay/{intentId}

Simulator (Gateway /simulator/pay/:intentId; PAYMENT_SIM_MODE=manual bấm nút, hoặc auto-success/auto-fail hẹn giờ PAYMENT_SIM_DELAY_MS)
   └ Payment.SIMULATE_PAYMENT → {payload, signature} → Payment.HANDLE_WEBHOOK  (đi đúng đường HMAC như cổng thật)

(Ngoài) Provider ─ POST /webhooks/payments {payload, signature} ─▶ Gateway (KHÔNG JwtAuth, vẫn cần x-api-key) ─▶ Payment.HANDLE_WEBHOOK (1 transaction)
   ├ HMAC-SHA256(JSON.stringify(payload), PAYMENT_WEBHOOK_SECRET) so bằng timingSafeEqual → sai = 400
   ├ eventId đã có trong payment_webhook_logs → {alreadyProcessed:true} (webhook trùng)
   ├ orderId/amount phải khớp intent (400); intent không tồn tại → 404
   ├ SUCCEEDED + intent PENDING|CANCELLED → SUCCEEDED + outbox PaymentSucceeded (kể cả intent đã CANCELLED: tiền đã thu)
   ├ FAILED + PENDING → FAILED + outbox PaymentFailed ; tổ hợp khác → no-op
   └ CancelPaymentIntent (Orders ra lệnh khi huỷ): UPDATE ... WHERE orderId AND status='PENDING' → CANCELLED (nguyên tử với webhook)
```

- `GET /payments/:orderId/transaction` (`PAYMENT|READ`) trả giao dịch (intent) mới nhất của đơn.
- Không tích hợp cổng ngoài: Payment/Shipping chỉ là simulator. `PAYMENT_WEBHOOK_SECRET`, `SHIPPING_WEBHOOK_SECRET` bắt buộc (không có fallback). Trang `/simulator/*` tắt (404) khi `NODE_ENV=production`.

### 2.7a Vận chuyển (Shipping)

```
Orders: FULFILLING → outbox CreateShipment {recipient, items} ─Kafka shipping-commands─▶ Shipping (inbox + TX)
   ├ chưa có shipment → carrier mô phỏng trả trackingCode → shipment CREATED + outbox ShipmentCreated{trackingCode}
   ├ đã có → no-op (carrier không bị gọi lại)
   └ carrier lỗi 3 lần (SHIPPING_SIM_MODE=fail để thử) → DLQ shipping-commands.dlq + shipment FAILED + outbox ShipmentFailed{reason}
CancelShipment (huỷ khi FULFILLING / ShipmentCreated tới đơn đã CANCELLED): CREATED → CANCELLED; khác → no-op
Giao hàng: webhook POST /webhooks/shipping {payload, signature} (HMAC SHIPPING_WEBHOOK_SECRET) hoặc admin POST /shipments/:orderId/deliver
   hoặc timer SHIPPING_SIM_DELIVER_DELAY_MS>0 → ShipmentDelivered{deliveredAt}
```

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

- `POST /vouchers/apply` (cũ) giữ nguyên: tính + tiêu lượt ngay, **không gắn đơn** nên không có cách trả lượt. Checkout dùng luồng riêng của Promotion: `VALIDATE_VOUCHER` (chỉ tính, không ghi) → `RESERVE_VOUCHER` (giữ lượt, idempotent theo `orderId`) → `OrderPaid` confirm / `OrderCancelled{paid:false}` release (xem §2.4).
- **Không gắn user**: không giới hạn lượt theo user — chỉ giới hạn bằng `usageLimit` toàn cục.
- `orderValue` của validate/reserve là **subtotal** (trước thuế/ship). Redemption `CONFIRMED` không bao giờ được trả lượt.

### 2.9 Đánh giá sản phẩm

```
User(REVIEW|CREATE) ─ POST /reviews {userId, productId, orderId, rating 1..5, comment?}
   └ Review service gọi Orders.GET_ORDER(orderId) qua TCP rồi kiểm tra:
        order tồn tại (404) VÀ order.userId == userId VÀ order.status ∈ {PAID,FULFILLING,SHIPPED,DELIVERED,COMPLETED} VÀ order.items chứa productId
        sai bất kỳ điều kiện → 403 "Chỉ có thể review sản phẩm đã mua trong đơn hàng hợp lệ"
   └ unique (userId, productId, orderId) → review lần 2 cho cùng cặp → "You have already reviewed this product for this order"
GET /reviews/product/:productId → danh sách mới nhất trước (không phân trang, không tính điểm trung bình)
```

- Rule "đã mua" = đơn thuộc user + đã thanh toán + chứa sản phẩm. `PENDING_PAYMENT`/`CANCELLED`/`REFUNDING`/`REFUNDED` **không** được review.
- `userId` lấy từ body chứ không từ JWT (xem rủi ro §5 của trade-offs).

### 2.10 Thông báo theo sự kiện đơn hàng

```
Orders Outbox ─ Kafka order-events (OrderCreated | OrderStatusChanged | OrderPaid | OrderCancelled) ─▶ Notification (consumer group notification-service)
   ├ Inbox (processed_messages) khử trùng theo eventId; retry 3 lần rồi DLQ order-events.dlq
   ├ OrderCreated / OrderStatusChanged: gọi User.GET_USER_INFO(userId) lấy email (lỗi → fallback userId làm recipient, log warn)
   │    → EmailProvider.send (Simulated: chỉ log) → ghi sent_notifications {channel=EMAIL, recipient, subject, body, status SENT|FAILED, sourceEvent}
   └ OrderPaid / OrderCancelled: chỉ đánh dấu inbox, không gửi (đã có OrderStatusChanged đi kèm)
Admin ─ (TCP) GET_SENT_NOTIFICATIONS {recipient?} → lịch sử gửi  [chưa có route Gateway tương ứng]
```

- Push (`PushProvider`) đã đăng ký DI nhưng **chưa có handler gọi**.
- Nội dung email là chuỗi cứng (tiếng Việt), chưa có template. Email at-least-once: nếu commit lỗi sau khi provider đã gửi thì có thể trùng.

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
| Không đủ tồn kho khi reserve (kèm `productIds`) / điều chỉnh làm `onHand < reserved` | inventory | 409 |
| Checkout thiếu `x-idempotency-key` / body có `userId`,`quantity`,`unitPrice` / món không có trong cart / `variantId` | gateway, orders | 400 |
| Hết hàng hoặc hết hạn giữ hàng (checkout, `GET /orders/:id/pay`) | orders | 409 |
| Đơn vừa thay đổi (lệch version) khi huỷ/hoàn hàng | orders | 409 |
| Huỷ đơn đã `SHIPPED`/`DELIVERED`/`REFUNDING` | orders | 409 |
| Hoàn hàng quá 7 ngày / đơn `COMPLETED` / không phải `DELIVERED` | orders | 400 |
| Đơn không tồn tại hoặc không thuộc user (pay/cancel/return) | orders | 404 |
| Redis lỗi ở route bắt buộc idempotency | gateway | 503 |
| Review sản phẩm chưa mua | review | 403 |
| Voucher hết hạn / hết lượt / chưa đủ giá trị tối thiểu | promotion | 400 |
| Request trùng `x-idempotency-key` đang xử lý | gateway | 409 |
| Webhook sai chữ ký (payment / shipping) | payment, shipping | 400 |
| Voucher không tồn tại | promotion | 404 |

---

## 4. Tài liệu liên quan

- [module-processing-flows.md](./module-processing-flows.md) — xử lý chi tiết từng module
- [design-trade-offs.md](./design-trade-offs.md) — quyết định thiết kế, đánh đổi, gap
- [system-architecture.md](./system-architecture.md) — kiến trúc tổng thể
- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) — Orchestrator/Outbox/Inbox chi tiết
- [target-checkout-architecture.md](./target-checkout-architecture.md) — thiết kế đã chốt + trạng thái triển khai (§10)
