# System Architecture — Orders Flow

**Ngày cập nhật**: 2026-10-15

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả các pattern trong luồng đơn hàng sau cutover checkout v2: Orchestration (Orders điều phối bằng event/command), Reserve → commit/release kho, Transactional Outbox + Inbox qua Kafka, khoá lạc quan trên Order, và flow end-to-end. Thiết kế gốc: [target-checkout-architecture.md](./target-checkout-architecture.md). Saga đồng bộ cũ (trừ kho → tạo đơn → charge → PROCESSING) **đã bị xoá**.

> **Trạng thái kiểm chứng**: code và unit test (mock) đã xong, `nest build` xanh; migration, int-spec (Postgres) và e2e qua Kafka thật **chưa chạy** tại thời điểm viết — chi tiết ở [target-checkout-architecture.md §10](./target-checkout-architecture.md).

---

## 1. Orchestration (Orders là bên duy nhất đổi trạng thái đơn)

Orders giữ state machine, các service khác chỉ nhận **command** và phát **event**:

```
PENDING_PAYMENT ─PaymentSucceeded─▶ PAID ─InventoryCommitted─▶ FULFILLING ─ShipmentCreated─▶ SHIPPED ─ShipmentDelivered─▶ DELIVERED ─scheduler 7 ngày─▶ COMPLETED
     │                                │                            │                                                        │
     └── hết 15' / PaymentFailed /    └── user huỷ / InventoryCommitFailed ──┴── ShipmentFailed ──▶ CANCELLED               └─ user hoàn hàng ─▶ REFUNDING ─PaymentRefunded─▶ REFUNDED
         REPLACED / chốt thất bại ──▶ CANCELLED
```

| Service | Nhận (command) | Phát (event) |
|---|---|---|
| Orders | — (consumer của 3 topic event) | `OrderCreated`, `OrderStatusChanged`, `OrderPaid`, `OrderCancelled` (+ command: `CommitInventory`, `ReleaseInventory`, `RestockInventory`, `CreateShipment`, `CancelShipment`, `RefundPayment`, `CancelPaymentIntent`) |
| Payment | `CancelPaymentIntent`, `RefundPayment` | `PaymentSucceeded`, `PaymentFailed`, `PaymentRefunded`, `PaymentRefundFailed` |
| Inventory | `CommitInventory`, `ReleaseInventory`, `RestockInventory` | `InventoryCommitted`, `InventoryCommitFailed` |
| Shipping | `CreateShipment`, `CancelShipment` | `ShipmentCreated`, `ShipmentDelivered`, `ShipmentFailed` |
| Promotion | (consumer `order-events`) | — |
| Notification | (consumer `order-events`) | — |

**Phần đồng bộ** của checkout (tới khi có `payment_url`) chạy bằng TCP trong `CheckoutHandler`:

```
1. Pricing: giá từ Product, số lượng từ cart, voucher validate → total
2. Inventory.RESERVE (ttl 15', replaces)        ── 409 nếu hết hàng
3. Promotion.RESERVE_VOUCHER                     ── lỗi → Inventory.RELEASE + lỗi gốc
4. TX Orders: INSERT order(PENDING_PAYMENT, expiresAt) + items + Outbox(OrderCreated); huỷ đơn `replaces`
5. Chốt #1: Inventory.CHECK_RESERVATION          ── không valid → huỷ đơn, 409, không tạo intent
6. Payment.CREATE_INTENT(idempotencyKey = orderId) → payment_url   ── lỗi/timeout chỉ log
7. Trả {orderId, status, payment_url, expiresAt}; KHÔNG xoá cart
```

`GET /orders/:id/pay` (chốt #2) kiểm lại: chủ đơn, `PENDING_PAYMENT`, chưa quá `expiresAt`, reservation còn `RESERVED`; không đạt → huỷ đơn + 409. Chốt #3: `expiresAt` của intent = hạn reservation.

**Tính chất**: reserve ≠ trừ thật; đơn bỏ dở tự nhả kho (scheduler 30s + job hết hạn của Inventory); hết hàng chỉ có thể xảy ra ở bước reserve. Sau reserve, hàng được giữ nên không bị người khác mua mất trong 15'.

### Gap còn lại
1. Crash giữa `Promotion.RESERVE_VOUCHER` và TX tạo đơn → lượt voucher bị giữ vĩnh viễn.
2. `Inventory.RESERVE` trả luôn phần giữ của đơn `replaces`; nếu sau đó voucher/TX lỗi thì đơn cũ còn `PENDING_PAYMENT` mà mất reservation (chốt #2/scheduler huỷ khi tới).
3. `PaymentRefundFailed` ở luồng hoàn hàng → đơn kẹt `REFUNDING`; refund `FAILED` không retry được.
4. Thanh toán muộn vào đơn `CANCELLED` → hoàn toàn bộ số đã thu (mặc định, chưa được xác nhận riêng).
5. SQL `replaces` (raw `orders JOIN order_items`), `UPDATE refunds` raw và `manager.insert(Refund, {order:{id}})` mới chỉ được kiểm bằng mock.

---

## 2. Transactional Outbox + Inbox (Kafka, at-least-once)

```
┌──────────────────────────────────────────────────────────────┐
│ Transaction của handler (checkout, consumer, scheduler, user)│
│  1. BEGIN                                                    │
│  2. (consumer) INSERT processed_messages(consumer,eventId)   │
│        ON CONFLICT DO NOTHING  → trùng: bỏ qua, không đổi gì │
│  3. UPDATE orders SET status=..., version=version+1          │
│        WHERE id AND version      → 0 dòng = lệch version     │
│  4. INSERT outbox(source, topic, key=orderId, eventType,     │
│        payload)  (OrderStatusChanged + event/command kèm)    │
│  5. COMMIT  (đổi state + Inbox + Outbox: all-or-nothing)     │
└──────────────────────────────────────────────────────────────┘
          │ OutboxRelayService (mỗi service chỉ relay row source của mình)
          ▼
   SELECT ... WHERE status='PENDING' AND source=$1 AND nextAttemptAt<=now()
          FOR UPDATE OF o SKIP LOCKED   (giữ thứ tự theo key, nhiều instance an toàn)
   → KafkaProducerService.send (acks=all, idempotent)
   → CHỈ đánh dấu PUBLISHED sau khi broker ack; lỗi → backoff, retryCount++, ≥ OUTBOX_MAX_RETRY → FAILED + metric
          ▼
   Kafka topic (key = orderId) ──▶ KafkaConsumerRunner của service đích
          lỗi → rollback (kể cả Inbox) → retry tối đa 3 → <topic>.dlq → onExhausted (phát event thất bại)
```

- Outbox lưu **payload**; envelope `{eventId, type, orderId, occurredAt, version, payload}` được dựng lúc relay.
- **At-least-once**, không exactly-once: consumer idempotent nhờ Inbox và nhờ đọc lại đơn + kiểm lại `canTransition` trong mỗi lần xử lý.
- Producer kết nối lười (Kafka tắt lúc boot không làm sập relay); `ensureKafkaTopics` gọi trong `main.ts` (broker tắt auto-create).
- Consumer `fromBeginning:false`: message phát trước khi group join lần đầu bị bỏ → khởi động Orders/Inventory/Shipping/Promotion/Notification trước khi có event đầu tiên.
- Giới hạn: `FAILED` chưa có alert rule/replay; DLQ chưa có công cụ replay. Chi tiết: [design-trade-offs.md §2.4](./design-trade-offs.md#24-transactional-outbox--inbox-qua-kafka-at-least-once).

---

## 3. Khoá lạc quan trên Order (chống đua trạng thái)

Mọi đổi trạng thái (user huỷ/hoàn hàng, `PaymentSucceeded`, `InventoryCommitted`, `ShipmentCreated`, scheduler...) dùng cùng một cơ chế qua `OrderTransitionService`:

```
1. Đọc đơn, lấy version v
2. canTransition(status, target)
3. UPDATE orders SET status=:target, version=version+1 WHERE id=:id AND version=:v   (cùng TX với Outbox/Inbox)
   0 dòng bị ảnh hưởng → OrderVersionConflictError → rollback toàn bộ TX
```

| Bên thua | Xử lý |
|---|---|
| Request user (huỷ/hoàn hàng) | Không retry, trả **409** "Đơn vừa thay đổi, hãy tải lại" |
| Consumer Kafka | TX rollback (Inbox cũng rollback) → runner retry → **đọc lại đơn, kiểm lại `canTransition`**; vd `ShipmentCreated` thấy đơn `CANCELLED` → gửi `CancelShipment` thay vì đổi trạng thái |
| Scheduler (hết hạn 15', auto `COMPLETED`) | Bỏ qua đơn lệch version, lần quét sau xử lý |

Lệch version không làm mất event: bên thua luôn đọc lại state mới rồi quyết định tiếp. Không dùng `save()` của TypeORM (`@VersionColumn` chỉ tăng version, không tự chặn ghi đè). Race huỷ vs `CommitInventory`: `RestockInventory` đi cùng partition key `orderId` với `CommitInventory` nên Inventory xử lý đúng thứ tự.

---

## 4. Reserve → commit/release (Inventory) và khoá DB

- `StockItem{productId, variantId?, onHand, reserved}` + `Reservation{orderId unique, items, status, expiresAt}`; `available = onHand − reserved`.
- `RESERVE` (1 transaction): khoá reservation `replaces` + **mọi** `stock_items` liên quan bằng một câu `ORDER BY id FOR UPDATE` (không deadlock); kiểm đủ hàng cho toàn bộ món TRƯỚC khi ghi (thiếu → 409, không ghi gì); trả phần đơn cũ, tăng `reserved`; idempotent theo `orderId`.
- `Commit`: `reserved -= q`, `onHand -= q`, `COMMITTED` (thành công khi reservation còn `RESERVED` kể cả hơi quá `expiresAt` vì kho vẫn đang giữ); `Release`: `reserved -= q`; `Restock`: COMMITTED → cộng lại `onHand`, `RESTOCKED`. Cả ba idempotent.
- Job hết hạn: reservation `RESERVED` quá `expiresAt` → `EXPIRED` + trả `reserved` (mỗi reservation 1 TX, `SKIP LOCKED`) — lưới an toàn khi Orders crash.
- CHECK `reserved >= 0 AND onHand >= reserved` ở DB là chốt chặn cuối cùng chống oversell.

**Pessimistic locking ở Promotion** (voucher): `RESERVE`/`RELEASE` khoá voucher rồi redemption (`FOR UPDATE`), `usageCount` kẹp ≥ 0; `CONFIRM` là một `UPDATE ... WHERE orderId AND status='RESERVED'` nguyên tử.

---

## 5. Data Flow: ví dụ checkout → giao hàng

```
1. CLIENT  POST /cart/checkout  (x-api-key, Authorization, x-idempotency-key BẮT BUỘC)
   Body: { items: [{productId}], shippingAddress, voucherCode? }      ← không có quantity/unitPrice/userId
2. GATEWAY  throttle → JwtAuthGuard (VERIFY_TOKEN) → IdempotencyInterceptor → ValidationPipe(forbidNonWhitelisted)
            → ORDER.CHECKOUT {userId từ token, dto}
3. ORDERS  CheckoutHandler (xem §1) → 201 {orderId, status:'PENDING_PAYMENT', payment_url, expiresAt}
4. CLIENT  GET /orders/{id}/pay → {paymentUrl, expiresAt} → mở /simulator/pay/{intentId} → "Thành công"
5. GATEWAY simulator: PAYMENT.SIMULATE_PAYMENT → PAYMENT.HANDLE_WEBHOOK (HMAC)
6. PAYMENT  TX: intent=SUCCEEDED + outbox PaymentSucceeded
   ── payment-events ──▶ ORDERS  TX: PAID + OrderPaid + CommitInventory; trừ cart đúng món đã đặt (afterCommit)
   ── inventory-commands ──▶ INVENTORY  TX: COMMITTED, trừ kho + InventoryCommitted
   ── inventory-events ──▶ ORDERS  TX: FULFILLING + CreateShipment
   ── shipping-commands ──▶ SHIPPING  carrier mô phỏng → CREATED + ShipmentCreated{trackingCode}
   ── shipping-events ──▶ ORDERS  TX: SHIPPED
7. GIAO HÀNG  POST /shipments/{orderId}/deliver (admin) | webhook /webhooks/shipping | timer
   ── ShipmentDelivered ──▶ ORDERS: DELIVERED (deliveredAt); scheduler 10': quá 7 ngày → COMPLETED
8. Phụ: OrderPaid → Promotion CONFIRM voucher; OrderStatusChanged → Notification email theo từng trạng thái
```

### Sequence Diagram (rút gọn)

```
Client     Gateway        Orders         Inventory     Payment      Shipping     Kafka
  │ checkout  │              │               │            │             │          │
  │──────────>│─ CHECKOUT ──>│─ RESERVE ────>│            │             │          │
  │           │              │<── RESERVED ──│            │             │          │
  │           │              │─ TX: order(PENDING_PAYMENT)+outbox(OrderCreated)    │
  │           │              │─ CHECK_RESERVATION ──────>│             │          │
  │           │              │─ CREATE_INTENT ───────────>│            │          │
  │<── 201 {payment_url} ────│                            │            │          │
  │ simulator success        │                            │            │          │
  │──────────>│─ webhook(HMAC) ─────────────────────────>│ TX: PaymentSucceeded │
  │           │              │<───────── payment-events ──────────────────────────│
  │           │              │ TX: PAID + OrderPaid + CommitInventory             │
  │           │              │──────── inventory-commands ───────────────────────>│
  │           │              │               │ COMMITTED + InventoryCommitted     │
  │           │              │<───────── inventory-events ────────────────────────│
  │           │              │ TX: FULFILLING + CreateShipment                    │
  │           │              │──────── shipping-commands ────────────────────────>│
  │           │              │               │            │ ShipmentCreated       │
  │           │              │<───────── shipping-events ─────────────────────────│
  │           │              │ TX: SHIPPED ... ShipmentDelivered → DELIVERED       │
```

---

## Tài liệu liên quan

- [system-architecture.md](./system-architecture.md) — Tổng quan kiến trúc, sơ đồ hệ thống
- [target-checkout-architecture.md](./target-checkout-architecture.md) — Thiết kế đã chốt + trạng thái triển khai
- [business-flows.md](./business-flows.md) · [module-processing-flows.md](./module-processing-flows.md) · [design-trade-offs.md](./design-trade-offs.md)
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) — Login, verify token, refresh, logout
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) — Middleware chain Gateway
- [project-roadmap.md](./project-roadmap.md) — Trạng thái và các gap đã biết
