# Target Architecture — Checkout, Fulfillment & Event-driven Orchestration

**Ngày cập nhật**: 2026-10-15
**Trạng thái**: 🎯 **THIẾT KẾ ĐÍCH — CHƯA IMPLEMENT.** Code hiện tại vẫn là Saga đồng bộ (xem [business-flows.md §2.4](./business-flows.md), [system-architecture-orders-flow.md](./system-architecture-orders-flow.md)). Tài liệu này là hợp đồng để lập plan; khi từng phần được code xong thì chuyển sang business-flows/module-processing-flows và đánh dấu ở §10.

## 1. Vì sao đổi

Luồng hiện tại (đã verify với code) có các lỗi cấu trúc mà vá lẻ không hết:

- Trừ kho **thật** ngay lúc checkout, không có reserve/TTL → đơn bỏ dở làm mất kho.
- Payment **đồng bộ** trong Saga: charge OK nhưng timeout ⇒ đơn bị huỷ dù đã thu tiền; Tx sau charge lỗi ⇒ đơn kẹt `PENDING`.
- Outbox at-most-once (đánh dấu `PUBLISHED` ngay sau `emit` TCP) → mất event là kẹt đơn, không có reconcile.
- Webhook payment không cập nhật gì; không có Shipping; voucher chưa nối checkout; không có job hết hạn.

Thiết kế đích: Order là **orchestrator** điều phối bằng event/command qua **Outbox → Kafka** (at-least-once, consumer idempotent); payment là bất đồng bộ qua `payment_url` + webhook; kho dùng reserve → commit/release.

## 2. Quyết định đã chốt (2026-10-15)

| Quyết định | Chốt | Ghi chú |
|---|---|---|
| Transport event/command giữa service | **Kafka** | **Đảo quyết định "không dùng RabbitMQ/broker"** cho kênh bất đồng bộ. RPC đồng bộ (Gateway→service, validate/reserve) **vẫn TCP**. Cập nhật CLAUDE.md gốc khi bắt đầu implement. |
| Inventory | **App riêng `apps/inventory` (:3008)** | Tách khỏi Product; sở hữu `stock`, `reservation`. Product chỉ còn catalog. |
| Shipping | **App riêng `apps/shipping` (:3009), carrier mô phỏng** | Theo phong cách Simulated + provider qua DI token. |
| Payment / Carrier ngoài | **Không tích hợp bên ngoài, chỉ Simulated** | Mô phỏng đủ vòng đời intent + webhook có HMAC, xem §10.1. Thay cổng thật sau = thêm provider mới. |
| Voucher | Nối vào bước Pricing của checkout | Dùng `apps/promotion` hiện có. |
| Refund | Hoàn hàng sau giao: `REFUNDING → REFUNDED`; huỷ trước khi ship: `CANCELLED` + hoàn tiền ở Payment | Mở rộng state machine. |
| Job thời gian | Hết hạn `PENDING_PAYMENT` (15') + auto `COMPLETED` (7 ngày) | Scheduler trong Orders. |
| Độ tin cậy messaging | **At-least-once + Inbox**, retry 3 lần rồi DLQ | Không exactly-once. |
| Chuyển đổi | **Cutover một lần** | Xoá Saga cũ khi luồng mới xong. |
| Huỷ/hoàn | Chỉ **cả đơn**; hoàn tiền trừ phí ship; voucher không trả sau khi đã thanh toán | Huỷ khi chưa ship; hoàn hàng khi `DELIVERED` trong 7 ngày; `COMPLETED` thì khoá. |
| Phạm vi lần này | **Chỉ cập nhật docs** | Chưa sửa code. |

## 3. State machine đơn hàng

```
PENDING_PAYMENT ──► PAID ──► FULFILLING ──► SHIPPED ──► DELIVERED ──► COMPLETED
      │               │            │             │
      ▼               ▼            ▼             ▼ (hoàn hàng, trong 7 ngày)
  CANCELLED ◄─────────┴────────────┘         REFUNDING ──► REFUNDED
```

- Huỷ (user hoặc hệ thống) ở `PENDING_PAYMENT`, `PAID`, `FULFILLING` → **`CANCELLED`** ngay. Nếu đã thanh toán thì việc hoàn tiền chạy tiếp ở Payment, không thêm trạng thái cho đơn (xem §7).
- `REFUNDING → REFUNDED` chỉ dùng cho **hoàn hàng sau `DELIVERED`**.

| Từ | Sang | Trigger |
|---|---|---|
| PENDING_PAYMENT | PAID | event `PaymentSucceeded` |
| PENDING_PAYMENT | CANCELLED | user huỷ / reservation hết hạn (15') / `PaymentFailed` |
| PAID | FULFILLING | event `InventoryCommitted` |
| PAID, FULFILLING | CANCELLED | user huỷ khi chưa ship; hoặc hệ thống huỷ do `InventoryCommitFailed` / `ShipmentFailed`. Ghi `cancelReason` (`USER`, `INVENTORY_COMMIT_FAILED`, `SHIPMENT_FAILED`) |
| FULFILLING | SHIPPED | event `ShipmentCreated` |
| SHIPPED | DELIVERED | event `ShipmentDelivered` (webhook hãng VC) |
| DELIVERED | REFUNDING | user yêu cầu hoàn hàng + hoàn tiền, **chỉ trong cửa sổ đổi trả** (7 ngày kể từ `deliveredAt`) |
| DELIVERED | COMPLETED | scheduler: quá cửa sổ đổi trả (mặc định 7 ngày, env) mà đơn vẫn `DELIVERED`. Đơn đang `REFUNDING` thì không auto-complete |
| REFUNDING | REFUNDED | event `PaymentRefunded` (chỉ luồng hoàn hàng sau giao) |

Terminal: `CANCELLED`, `REFUNDED`, `COMPLETED`. Mọi chuyển trạng thái đi qua `canTransition` + ghi Outbox **cùng transaction**. Thay đổi so với hiện tại: bỏ `PENDING`/`PROCESSING` (→ `PENDING_PAYMENT`), thêm `FULFILLING`, `COMPLETED`, `REFUNDING`. Cần migration chuyển dữ liệu cũ (đề xuất: `PENDING`,`PROCESSING` → `PENDING_PAYMENT`; còn lại giữ tên).

## 4. Service & trách nhiệm

| Service | Vai trò | Dữ liệu sở hữu |
|---|---|---|
| `gateway` | Auth, route; `POST /cart/checkout` trả `payment_url` | — |
| `orders` (:3002) | Orchestrator, state machine, outbox, scheduler | Order, OrderItem, Refund, Outbox, Inbox |
| `inventory` (:3008) **mới** | reserve/commit/release kho | StockItem, Reservation, Outbox, Inbox |
| `payment` (:3004) | `createIntent`, webhook, refund | PaymentTransaction, WebhookLog, Outbox, Inbox |
| `shipping` (:3009) **mới** | Tạo vận đơn, webhook giao hàng | Shipment, Outbox, Inbox |
| `promotion` (:3007) | Validate/reserve/confirm/release voucher | Voucher, VoucherRedemption |
| `notification` (:3005) | Email theo event | SentNotification |
| `product` (:3003) | Chỉ catalog (giá, thuộc tính); không còn sở hữu stock | Product, Variant… |

Mỗi service ghi Outbox cùng transaction và có **Inbox** (`processed_messages`) để khử trùng.

## 5. Luồng checkout (đồng bộ, tới khi có `payment_url`)

### 5.0 Luồng FE và hợp đồng request

1. User xem giỏ, **tick chọn** các món muốn mua (một phần giỏ, không bắt buộc cả giỏ), bấm nút Checkout.
2. FE gửi `POST /cart/checkout` với `{ items: [{ productId, variantId? }], shippingAddress, voucherCode? }`. **Chỉ gửi định danh món được chọn**, không gửi `quantity`, `unitPrice`, `userId`.
3. Server lấy `userId` từ token, **số lượng từ cart** (cart là nguồn sự thật), **giá từ Product**. Không tin số lượng/giá từ client.
4. Validate: danh sách chọn không rỗng; mọi món phải có trong cart của user (không thì 400); không trùng `productId`. Các món **không được chọn** không bị đụng tới.
5. FE nhận `{orderId, status: PENDING_PAYMENT, payment_url, expiresAt}` rồi chuyển user sang `payment_url`.

Khác hiện tại: [cart.controller.ts](../apps/gateway/src/orders/cart.controller.ts) đang checkout **toàn bộ** giỏ và không nhận danh sách chọn; DTO `ShippingAddressDto` là body duy nhất.

```
Client ─POST /cart/checkout (x-idempotency-key BẮT BUỘC)─► Gateway ─► Orders
  1. Nhận danh sách món user **đã chọn** trong giỏ (§5.0); đối chiếu với cart, lấy số lượng từ cart; lấy giá từ Product (server-side); Promotion.validate(voucher) → discount;
     tính subtotal/tax/ship/discount/total. Sinh orderId (UUID) trước.
  2. Inventory.reserve(orderId, items, ttl=15') [TCP sync]
       hết hàng → 409, dừng (chưa có gì để hoàn). Reserve atomic toàn bộ items hoặc không item nào.
  3. TX Orders: INSERT order(PENDING_PAYMENT, expiresAt) + items; INSERT outbox(OrderCreated)
       lỗi TX → Inventory.release(orderId) best-effort; nếu fail vẫn an toàn vì reservation tự hết hạn.
  4. CỔNG #1 — Orders hỏi Inventory.checkReservation(orderId) [TCP sync]: phải RESERVED và chưa quá expiresAt.
       không đạt → huỷ đơn (CANCELLED), 409 "hết hàng/hết hạn giữ hàng", KHÔNG tạo intent.
  5. Payment.createIntent(orderId, amount, idempotencyKey=orderId, expiresAt=reservation.expiresAt) [TCP sync] → payment_url
       lỗi/timeout → đơn vẫn PENDING_PAYMENT; retry createIntent idempotent; không retry được thì expiry job huỷ.
  6. KHÔNG xoá cart ở bước này. Cart giữ nguyên cho tới khi thanh toán thành công (xem §5.2).
Client ◄── {orderId, status: PENDING_PAYMENT, payment_url, expiresAt}
```

Điểm khác với hiện tại: reserve ≠ trừ thật; không charge trong request; hết hạn tự dọn (không cần job quét thủ công như gap hiện tại).

### 5.1 Quy tắc: chỉ cho thanh toán khi còn hàng

Người dùng chỉ được thanh toán khi hàng **vẫn đang được giữ** cho đơn đó. Có 3 chốt:

| Chốt | Khi nào | Kiểm tra | Không đạt thì |
|---|---|---|---|
| #1 Trước khi cấp `payment_url` | Bước 4 checkout | Reservation `RESERVED` và chưa hết hạn | Huỷ đơn, 409, không tạo intent |
| #2 Lúc bắt đầu thanh toán | User mở/bấm trả tiền: endpoint `GET /orders/:id/pay` (Gateway→Orders) trả lại URL hoặc redirect | Đơn `PENDING_PAYMENT`, chưa quá `expiresAt`, `Inventory.checkReservation` còn `RESERVED` | 409 `Hết hàng hoặc hết hạn giữ hàng`; Orders huỷ đơn (nếu đã hết hạn) và vô hiệu intent |
| #3 Hạn của intent | Lúc tạo intent | `expiresAt` của intent = `expiresAt` của reservation, không dài hơn | Cổng thanh toán tự từ chối sau hạn |

- Cổng thanh toán thật tự host trang trả tiền nên ta không chặn được từng lần bấm; chốt #3 là cách bảo đảm. Vì vậy `payment_url` trả cho client nên trỏ qua endpoint của ta (chốt #2) rồi mới redirect sang cổng, thay vì trỏ thẳng.
- Khoảng hở còn lại (user trả tiền sát giờ hết hạn, webhook tới sau khi reservation đã `EXPIRED`) xử lý ở §7: tự hoàn tiền, không để đơn thành `PAID` khi không còn hàng.
- Hết hàng chỉ có thể xảy ra ở bước reserve (chốt trước đó). Sau khi reserve thành công, hàng được giữ nên không bị người khác mua mất trong 15'.

### 5.2 Vòng đời giỏ hàng

Giỏ hàng là của user, không thuộc đơn. Đơn chỉ là snapshot lúc checkout.

| Sự kiện | Cart |
|---|---|
| Checkout (tạo đơn `PENDING_PAYMENT`) | **Giữ nguyên** (cả món đã chọn lẫn món không chọn) |
| Thanh toán thất bại / quá hạn 15' / user huỷ (`CANCELLED`) | **Giữ nguyên**, user checkout lại được ngay |
| `OrderPaid` | Orders xoá khỏi cart **đúng các item đã đặt** (theo `productId` + số lượng trong đơn), không xoá cả cart |

- Cart nằm ở Orders (Redis `cart:{userId}`) nên Orders tự xử lý khi `PaymentSucceeded → PAID`, trong cùng handler chuyển `PAID`. Lỗi xoá cart chỉ log, không làm hỏng việc chuyển trạng thái.
- Món không được chọn lúc checkout luôn còn nguyên trong cart. Nếu số lượng trong cart của một món đã đặt lớn hơn số trong đơn (user tăng thêm khi chờ), chỉ trừ đi phần đã đặt, phần dư giữ lại.
- Chỉ xoá đúng item của đơn vì trong lúc chờ thanh toán user có thể đã thêm món mới vào cart; xoá cả cart sẽ làm mất các món đó.
- Cart còn nguyên trong lúc có đơn `PENDING_PAYMENT` đang giữ hàng, nên user có thể checkout lại; quy tắc xử lý ở §5.3.

### 5.3 Checkout lại khi đã có đơn chờ thanh toán

Quy tắc nghiệp vụ (đã chốt): user back khỏi trang thanh toán = chưa trả tiền; đơn vẫn chờ tới hết 15' rồi tự huỷ và trả kho. Mỗi lần bấm Checkout luôn tạo **đơn mới**. Món nào trùng với đơn chờ cũ thì **thuộc về đơn mới**.

Ví dụ: đơn #1 giữ A,B,C (mỗi món ×1), chưa trả tiền.

| User làm gì | Kết quả |
|---|---|
| Không làm gì | Hết 15': #1 `CANCELLED`, trả kho A,B,C. Cart vẫn còn A,B,C |
| Checkout lại A,B,C | Đơn #2 giữ A,B,C; #1 bị `CANCELLED` (trả phần giữ) |
| Checkout lại chỉ A | Đơn #2 giữ A. A là của #2 nên #1 bị `CANCELLED` toàn bộ, B và C **không còn được giữ** |
| Checkout chỉ D (không trùng) | Đơn #2 giữ D; #1 vẫn chờ, không đổi |

Quy tắc cài đặt:
- Đơn **không sửa item sau khi tạo** (tiền và payment intent đã cố định). Vì vậy khi đơn cũ có bất kỳ món nào trùng với đơn mới thì đơn cũ bị huỷ **toàn bộ**, không cắt bớt món.
- Orders tìm các đơn `PENDING_PAYMENT` của user có món trùng, rồi gọi `Inventory.reserve(orderId, items, replaces=[orderIdCũ...])`. Inventory làm trong **một transaction**: giải phóng phần giữ của đơn cũ và giữ phần cho đơn mới. Nhờ đó nếu hàng chỉ còn 1 cái, user không bị 409 vì chính phần mình đang giữ, và nếu reserve mới lỗi thì đơn cũ không mất phần giữ.
- Sau khi reserve thành công, Orders chuyển các đơn cũ sang `CANCELLED` (cùng transaction tạo đơn mới) và vô hiệu intent của chúng.
- Nếu user vẫn trả tiền ở trang của đơn cũ đã bị huỷ: chốt #2 từ chối; nếu webhook vẫn tới thì tự hoàn tiền (§7).

## 6. Luồng sau thanh toán (bất đồng bộ qua Kafka)

```
Cổng TT ─webhook─► Payment: verify HMAC; TX: payment=SUCCEEDED + outbox PaymentSucceeded
   │ payment-events
   ▼
Orders: TX: order=PAID; outbox OrderPaid (event) + CommitInventory (command)
   │ inventory-commands
   ▼
Inventory: TX: reservation RESERVED→COMMITTED, trừ stock thật; outbox InventoryCommitted
   │ inventory-events
   ▼
Orders: TX: order=FULFILLING; outbox CreateShipment (command)
   │ shipping-commands
   ▼
Shipping: gọi carrier (mô phỏng) → mã vận đơn; TX: shipment=CREATED; outbox ShipmentCreated
   │ shipping-events
   ▼
Orders: SHIPPED ... carrier webhook "đã giao" → Shipping outbox ShipmentDelivered → Orders: DELIVERED
Scheduler: DELIVERED quá N ngày → COMPLETED
```

Phụ: `OrderPaid` → Promotion confirm voucher; `OrderPaid/OrderStatusChanged` → Notification gửi email.

## 7. Nhánh lỗi & bù trừ

| Tình huống | Xử lý |
|---|---|
| Quá 15' chưa thanh toán | Scheduler: `PENDING_PAYMENT→CANCELLED`; outbox `ReleaseInventory` + `ReleaseVoucher`; vô hiệu intent |
| `PaymentFailed` | Như trên (huỷ + release) |
| `PaymentSucceeded` tới đơn đã `CANCELLED` (thanh toán muộn) | Orders ra command `RefundPayment` tự động; đơn giữ `CANCELLED`, ghi log đối soát |
| Chốt #1/#2 phát hiện reservation hết hạn hoặc mất | Không cấp/không cho thanh toán; đơn `PENDING_PAYMENT→CANCELLED`, trả 409 cho client; vô hiệu intent đã tạo |
| `CommitInventory` thất bại (reservation đã hết hạn/không đủ) | Inventory phát `InventoryCommitFailed` → Orders: `PAID→CANCELLED` (`cancelReason=INVENTORY_COMMIT_FAILED`) → Payment hoàn tiền (§7.1) |
| Shipping tạo vận đơn lỗi | Shipping **retry tối đa 3 lần**; vẫn lỗi → đẩy message `CreateShipment` vào DLQ `shipping-commands.dlq` và phát `ShipmentFailed` (outbox) → Orders: `FULFILLING→CANCELLED` (`cancelReason=SHIPMENT_FAILED`) → Payment hoàn tiền (trừ phí ship, §7.1) + Inventory `RestockInventory`. Không giữ đơn chờ tay. Voucher không trả (đơn đã thanh toán) |
| Hoàn hàng khi `DELIVERED` (trong 7 ngày) | User bấm "Hoàn hàng" → `DELIVERED→REFUNDING`; Payment hoàn tiền (trừ phí ship, §7.1); Inventory nhập kho lại ngay khi hoàn tiền xong (không theo dõi vận đơn trả về); `PaymentRefunded → REFUNDED`. Voucher không trả. Đơn đã `COMPLETED` → 400, không còn hoàn hàng |
| User chủ động huỷ đơn sau khi đã thanh toán, **khi chưa bắt đầu ship** (`PAID`/`FULFILLING`, chưa có `ShipmentCreated`) | **`→ CANCELLED`** ngay (`cancelReason=USER`); outbox `OrderCancelled` → Payment hoàn tiền (trừ phí ship, §7.1) và Inventory nhập lại phần đã commit trừ kho (`RestockInventory`), chạy song song; voucher không trả. Đơn không chuyển trạng thái nữa; tiến độ hoàn tiền nằm ở Payment (`refund: PENDING→SUCCEEDED|FAILED`), Orders chỉ ghi `refundedAmount`/`refundedAt` khi nhận `PaymentRefunded`. Chỉ huỷ/hoàn **cả đơn**. Từ `SHIPPED` đến trước `DELIVERED` **không** huỷ được; có `DELIVERED` mới có nút hoàn hàng (dòng trên) |
| Huỷ lúc đơn `PAID`, kho chưa commit xong (race) | Nút Huỷ hiện ngay khi `PAID`. Orders chuyển `CANCELLED` rồi gửi `RestockInventory` (idempotent) sang `inventory-commands` **cùng partition key `orderId`** với `CommitInventory` nên Inventory xử lý theo đúng thứ tự: nếu commit chạy trước thì restock cộng lại kho; nếu reservation còn `RESERVED` thì restock chỉ release. Khi `InventoryCommitted` tới đơn đã `CANCELLED` thì Orders bỏ qua, **không** tạo `CreateShipment` |
| Huỷ lúc đang `FULFILLING` mà vận đơn sắp được tạo (race) | Quyết định bằng **optimistic lock trên Order** (§7.2): bên nào cập nhật thành công trước thì thắng, bên sau fail do lệch version. Huỷ thắng → `CANCELLED`, nếu sau đó `ShipmentCreated` tới thì Orders gửi `CancelShipment` bù trừ. `ShipmentCreated` thắng → đơn `SHIPPED`, yêu cầu huỷ bị từ chối (409) |
| Consumer nhận trùng message | Inbox: bỏ qua nếu `(consumer, eventId)` đã xử lý |

### 7.1 Số tiền hoàn

`refundAmount = totalAmount − shippingFee` (tức subtotal + tax − discount). **Phí ship không hoàn** ở mọi luồng hoàn: user huỷ khi chưa ship, hoàn hàng sau `DELIVERED`, và cả khi Shipping lỗi vĩnh viễn rồi hệ thống tự hoàn. Voucher không trả. Payment `refund` nhận `amount` tường minh (không mặc định bằng số đã thu), Orders tính từ `shippingFee` đã lưu trên đơn.

**Hiển thị cho user**: Order có cột `refundStatus` (`NONE|PENDING|SUCCEEDED|FAILED`) chỉ để hiển thị, **không** đổi trạng thái đơn. `OrderCancelled` (đơn đã thanh toán) đặt `PENDING`; nhận `PaymentRefunded`/`PaymentRefundFailed` thì cập nhật `SUCCEEDED`/`FAILED` kèm `refundedAmount`, `refundedAt`. `FAILED` cảnh báo admin xử lý tay. Luồng hoàn hàng (`REFUNDING→REFUNDED`) không cần cột này. *(Đã chốt.)*

### 7.2 Chống đua khi đổi trạng thái đơn (optimistic lock)

Mọi thay đổi trạng thái của Order (user huỷ, `PaymentSucceeded`, `InventoryCommitted`, `ShipmentCreated`, scheduler hết hạn…) đều dùng chung một cơ chế:

1. Đọc đơn, lấy `version` hiện tại.
2. Kiểm tra `canTransition(status, target)`.
3. Cập nhật có điều kiện: `UPDATE orders SET status=:target, version=version+1 WHERE id=:id AND version=:v` (cùng transaction với ghi Outbox/Inbox). **0 dòng bị ảnh hưởng = lệch version = thất bại**, rollback toàn bộ transaction (kể cả Outbox/Inbox).

Xử lý khi thất bại:

| Bên thất bại | Xử lý |
|---|---|
| Request của user (huỷ, hoàn hàng) | **Không tự retry.** Trả 409 "đơn vừa thay đổi, hãy tải lại"; FE tải lại trạng thái, nút Huỷ tự ẩn nếu đơn đã `SHIPPED` |
| Consumer Kafka (`ShipmentCreated`, `InventoryCommitted`, `PaymentSucceeded`…) | Transaction rollback nên Inbox chưa ghi; message được xử lý lại (tối đa 3 lần theo §8), mỗi lần **đọc lại đơn và kiểm tra lại `canTransition`**. Kết quả tuỳ trạng thái mới: ví dụ `ShipmentCreated` thấy đơn đã `CANCELLED` thì gửi `CancelShipment` thay vì đổi trạng thái |
| Scheduler (hết hạn 15', auto `COMPLETED`) | Bỏ qua đơn lệch version, lần chạy sau quét lại |

Lệch version không bao giờ làm mất event: bên thua luôn đọc lại state mới rồi quyết định tiếp. Triển khai bằng `UPDATE … WHERE version` tường minh (không dựa vào `save()` của TypeORM vì `@VersionColumn` chỉ tăng version, không tự chặn ghi đè). Cần cột `version` trên bảng `orders` (migration).

## 8. Hợp đồng messaging (Kafka)

- Client: `@nestjs/microservices` `Transport.KAFKA`; Docker Compose thêm Kafka (KRaft, 1 broker local) — cập nhật `npm run docker:up`.
- **Topic** (partition key = `orderId` để giữ thứ tự theo đơn): `order-events`, `payment-events`, `payment-commands`, `inventory-commands`, `inventory-events`, `shipping-commands`, `shipping-events`.
- **Envelope** chuẩn: `{ eventId (uuid), type, orderId, occurredAt, version, payload }`. Command và event cùng envelope, phân biệt qua `type` + topic.
- **Outbox relay** (mỗi service): đọc row `PENDING` bằng `FOR UPDATE SKIP LOCKED` (an toàn nhiều instance) → produce `acks=all`, idempotent producer → **chỉ đánh dấu `PUBLISHED` sau khi broker ack**; lỗi thì tăng `retryCount`/backoff, quá ngưỡng `FAILED` + metric. ⇒ **at-least-once** (khác hiện tại là at-most-once).
- **Consumer**: group theo service; xử lý trong 1 TX gồm ghi Inbox + đổi state + ghi Outbox; handler không throw cho message trùng; lỗi vĩnh viễn → DLQ topic `<topic>.dlq`. Retry tối đa **3 lần** (áp dụng cho consumer, ví dụ Shipping `CreateShipment`); hết lượt thì vào DLQ và service phát event thất bại tương ứng (xem §7). Độ tin cậy: **at-least-once + Inbox**, không dùng exactly-once/Kafka transactions.
- Orders/Inventory/Shipping/Payment đều là consumer + producer ⇒ mỗi service cần `kafka` config trong `main.ts` (hybrid app: TCP + Kafka).
- Outbox entity thêm cột `topic`, `key`, `eventId`; migration chung như quy ước.

## 9. Inventory: mô hình reserve

- `Reservation{orderId unique, items jsonb|bảng con, status RESERVED|COMMITTED|RELEASED|EXPIRED, expiresAt}`; `StockItem{productId|variantId, onHand, reserved}`; available = `onHand − reserved`.
- `reserve`: 1 TX, khoá theo thứ tự id để tránh deadlock; đủ hàng thì tăng `reserved`; idempotent theo `orderId`.
- `checkReservation(orderId)`: chỉ đọc, trả `{valid, status, expiresAt}`; dùng cho chốt #1/#2 ở §5.1. `valid = status RESERVED && now < expiresAt`.
- `commit`: `reserved -= q`, `onHand -= q`; idempotent. `release`: `reserved -= q`; idempotent, no-op nếu đã COMMITTED/RELEASED.
- Job dọn `EXPIRED` (reservation quá `expiresAt` mà Orders chưa release) — lưới an toàn cho case Orders crash.
- Migration tách `stock` khỏi Product/Variant sang Inventory (giữ `ADJUST_STOCK` thủ công chuyển sang Inventory). Catalog (cách A, đã chốt): Gateway lấy danh sách Product rồi gọi Inventory **một lần** theo mảng id để ghép `available`; Inventory lỗi/chậm thì trả "không rõ tồn kho", không làm lỗi cả danh sách.

## 10. Phạm vi implement & trạng thái

| Hạng mục | Trạng thái |
|---|---|
| State machine mới + migration | ⏳ Chưa làm |
| Kafka + outbox relay at-least-once + inbox | ⏳ Chưa làm |
| `apps/inventory` (reserve/commit/release + expiry) | ⏳ Chưa làm |
| Payment `createIntent` + webhook→outbox + refund | ⏳ Chưa làm |
| `apps/shipping` + carrier mô phỏng + webhook giao hàng | ⏳ Chưa làm |
| Voucher nối checkout (validate → reserve → confirm/release) | ⏳ Chưa làm |
| Refund: huỷ → `CANCELLED` + hoàn tiền ở Payment; hoàn hàng → `REFUNDING→REFUNDED` | ⏳ Chưa làm |
| Scheduler hết hạn 15' + auto COMPLETED 7 ngày | ⏳ Chưa làm |
| Gateway: checkout trả `payment_url`, idempotency bắt buộc | ⏳ Chưa làm |

**Chuyển đổi: cutover một lần** — không feature flag, không chạy song song; Saga cũ (`CreateOrderHandler` đồng bộ) bị xoá khi luồng mới hoàn tất, kèm migration trạng thái đơn và chuyển stock sang Inventory.

Thứ tự đề xuất khi lập plan: (1) Kafka + outbox/inbox nền tảng → (2) Inventory → (3) Payment intent/webhook + state machine mới → (4) Shipping → (5) Voucher + Refund + scheduler → (6) dọn code Saga cũ.

### 10.1 Simulator (Payment & Shipping)

Không gọi dịch vụ ngoài. Provider mô phỏng chạy trong chính service, qua DI token `PAYMENT_PROVIDER` / `SHIPPING_PROVIDER`, và đi **đúng đường webhook thật** để các bước bất đồng bộ được kiểm thử đầy đủ.

**Payment**
1. `createIntent` lưu intent `PENDING` (`expiresAt` theo §5.1) và trả `payment_url` trỏ về hệ thống: `/simulator/pay/:intentId` (qua chốt #2).
2. Trang simulator hiện thông tin đơn và nút "Thanh toán thành công" / "Thanh toán thất bại" (chỉ bật khi không phải production).
3. Bấm nút (hoặc timer ở chế độ auto) → simulator gửi request tới `/webhooks/payments` **kèm chữ ký HMAC** như cổng thật → Payment verify → `PaymentSucceeded|PaymentFailed` qua outbox.
4. Phải mô phỏng được các nhánh: thất bại, trả muộn sau hết hạn giữ hàng, webhook gửi trùng (kiểm tra idempotency theo `eventId`).

**Shipping**: carrier giả trả mã vận đơn ngẫu nhiên khi `CreateShipment`. "Đã giao" do timer hoặc endpoint admin kích hoạt → phát webhook `ShipmentDelivered` về Shipping.

**Env (đề xuất, đều tuỳ chọn)**

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `PAYMENT_SIM_MODE` | `manual` (bấm nút) / `auto-success` / `auto-fail` | `manual` |
| `PAYMENT_SIM_DELAY_MS` | Độ trễ trước khi tự gọi webhook ở chế độ auto | `3000` |
| `SHIPPING_SIM_DELIVER_DELAY_MS` | Độ trễ tự chuyển "đã giao"; `0` = chỉ kích hoạt tay | `0` |

**Ràng buộc bảo mật**: webhook của simulator **vẫn phải verify HMAC**, không bỏ qua chữ ký. Hiện `PAYMENT_WEBHOOK_SECRET` có fallback `simulated-webhook-secret` (xem [payment/CLAUDE.md](../apps/payment/CLAUDE.md)); khi implement nên bắt buộc đặt secret qua env (đưa vào `validateEnv`) thay vì fallback. Route `/simulator/*` phải tắt khi `NODE_ENV=production`.

## 11. Câu hỏi mở (cần chốt trước khi code)

1. ~~Đổi trả sau giao~~ → **đã chốt**: hoàn hàng + hoàn tiền khi `DELIVERED` trong 7 ngày; không mô hình hoá vận đơn trả về, nhập kho lại khi hoàn tiền xong (§3, §7).
2. ~~Shipping thất bại vĩnh viễn~~ → **đã chốt**: retry 3 lần, lỗi thì vào DLQ, tự hoàn tiền + trả kho (§7).
3. ~~Voucher~~ → **đã chốt**: giữ lượt lúc checkout, trả khi đơn chưa thanh toán bị huỷ/hết hạn. Đơn **đã thanh toán** rồi huỷ/hoàn thì voucher **không trả** (§7).
4. ~~Hiển thị tồn kho ở catalog~~ → **đã chốt: cách A**, Gateway gọi Inventory một lần theo danh sách id rồi ghép vào kết quả Product; Inventory chậm/lỗi thì trả không rõ tồn kho, không làm hỏng danh sách (§9).
5. ~~Payment thật hay Simulated~~ → **đã chốt: chỉ Simulated**, không tích hợp bên ngoài (xem §10.1).
6. ~~Kafka exactly-once?~~ → **đã chốt: at-least-once + inbox** (§8).
7. ~~Gia hạn giữ hàng~~ → **đã chốt: không gia hạn.** Hết 15' chưa thanh toán = thanh toán thất bại, đơn `CANCELLED`, hàng thôi được giữ (§7). Muốn mua tiếp thì checkout lại.
8. ~~Giai đoạn chuyển tiếp~~ → **đã chốt: cutover một lần**, xoá Saga cũ khi luồng mới xong, không feature flag (§10).
9. ~~Checkout lặp khi đã có đơn chờ~~ → **đã chốt** (§5.3): checkout lại luôn tạo đơn mới, món trùng thuộc về đơn mới, đơn cũ có món trùng bị huỷ toàn bộ. "Huỷ đơn" chủ động là **sau khi đã thanh toán** (đã chốt: hoàn tiền + trả kho, xem §7); đơn chưa thanh toán không cần nút huỷ, chỉ chờ hết 15'.
10. ~~Huỷ đơn~~ → **đã chốt**: huỷ được khi chưa bắt đầu ship; đã ship thì không huỷ cho tới `DELIVERED` mới có nút hoàn hàng; `COMPLETED` không làm gì nữa. Cách giải race `FULFILLING` (state commit trước thắng + `CancelShipment` bù trừ) là **thiết kế mặc định của tôi** ở §7, chưa được bạn xác nhận riêng.
11. ~~Số tiền hoàn~~ → **đã chốt**: hoàn `totalAmount − shippingFee` (§7.1); phí ship không trả; voucher không trả.
12. ~~Huỷ/hoàn một phần~~ → **đã chốt**: chỉ cả đơn.

## 12. Tài liệu liên quan

[business-flows.md](./business-flows.md) · [module-processing-flows.md](./module-processing-flows.md) · [design-trade-offs.md](./design-trade-offs.md) · [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) · [project-roadmap.md](./project-roadmap.md)
