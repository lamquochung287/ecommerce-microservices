# System Architecture — Orders Flow

**Ngày cập nhật**: 2026-10-05

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả chi tiết các pattern nghiệp vụ trong Orders service: Checkout Saga, Transactional Outbox, Optimistic/Pessimistic Locking, và flow checkout đầy đủ end-to-end.

---

## 1. Checkout Saga Pattern (Orders Service)

Saga phân tán điều phối flow checkout phức tạp, có compensation logic khi bước nào đó fail.

> **Quan trọng**: Product service **không có** RPC riêng cho "reserve" hay "release" stock — chỉ có **1 message pattern duy nhất `ADJUST_STOCK`** nhận `{ productId, delta }`. "Reserve" = gọi `ADJUST_STOCK` với `delta` âm (trừ ngay lập tức, không phải giữ chỗ tạm thời); "Release" (compensation) = gọi lại chính pattern đó với `delta` dương để cộng trả lại. Đây là điểm dễ bị hỏi xoáy trong phỏng vấn: **không có khái niệm "reservation" tách biệt khỏi số dư thực** — nếu muốn true 2-phase reservation (hold riêng, confirm/release sau) thì cần thêm state (vd: cột `reservedStock` riêng), hiện tại chưa có.

```
Step 1: Reserve Inventory (thực chất là trừ stock ngay)
├─ Gọi: PRODUCT_MESSAGE_PATTERN.ADJUST_STOCK, delta = -quantity (tuần tự từng item, timeout 10s)
└─ NẾU 1 item fail giữa chừng: [Compensation] hoàn (delta dương) các item đã trừ trước đó rồi ném lỗi gốc (409 "Không đủ tồn kho")

Step 2: Create Order in DB (TRANSACTION #1, tách khỏi Step 1)
├─ INSERT Order (status=PENDING) + OrderItems (+ snapshot địa chỉ giao hàng, giá)
└─ Chưa ghi Outbox ở bước này
   └─ ⚠️ Gap: crash giữa Step 1 và Step 2 → stock đã bị trừ nhưng chưa có Order để biết cần hoàn

Step 3: Charge Payment
├─ Gọi: Payment.CHARGE_PAYMENT { orderId, amount, idempotencyKey = orderId } (timeout 10s)
├─ TcpPaymentProvider bắt mọi lỗi TCP/timeout → quy về { success:false, failureReason:'Payment service unavailable' }
└─ NẾU success=false: [Compensation] release stock (best-effort) + Order → CANCELLED + ném RpcException 402

Step 4: Confirm & Publish Event (TRANSACTION #2)
├─ UPDATE Order → PROCESSING
├─ INSERT Outbox (eventType='order.created', payload={orderId,userId,totalAmount})
└─ OutboxWorker sẽ fan-out event tới Notification
```

**Tính chất quan trọng**:
- **Atomicity**: chỉ từng transaction (#1, #2) là atomic; Step 1 (TCP trừ kho) và Step 3 (TCP charge) nằm ngoài DB transaction.
- **Idempotency**: `Payment.CHARGE_PAYMENT` khử trùng theo `idempotencyKey = orderId`.
- **Compensation**: kích hoạt cả khi Payment trả fail lẫn khi timeout/exception (đã sửa so với bản trước). `release()` là best-effort — lỗi chỉ được log.
- Outbox chỉ được ghi khi đơn thành công (Step 4) và khi `UpdateOrderStatus`; đơn CANCELLED do payment fail **không** phát event.

### Gap chưa được xử lý

1. **Cửa sổ lỗi S1→S2 / S2→S3**: crash process sau khi đã trừ kho nhưng trước khi có order (hoặc order kẹt `PENDING`) → kho bị trừ mà không có dấu vết/compensation, chưa có job quét đơn `PENDING` quá hạn. Là hệ quả của saga không có state bền.
2. **Payment charge thành công nhưng phản hồi timeout**: Orders coi là fail → huỷ đơn + hoàn kho, trong khi tiền đã trừ. Idempotency key giúp lần retry trả đúng kết quả cũ, nhưng chưa có job đối soát.
3. **Outbox `FAILED`** sau 5 lần: không alert/replay; ngoài ra `emit` TCP không ack nên thực tế at-most-once (xem mục 2).
4. **`payment_succeeded/failed`** do Payment emit được `PaymentEventsController` ở Orders nhận: `payment_succeeded` → `PROCESSING→PAID` (chờ thử lại nếu đơn còn PENDING), `payment_failed` → chỉ log.

**Sơ đồ flow**:
```
Request → Reserve Stock ──OK──> Create Order(PENDING) ──OK──> Charge Payment ──OK──> PROCESSING + Outbox
               │ FAIL                                              │ FAIL / timeout
               ▼                                                   ▼
        (hoàn các item đã trừ)                  Release Stock + Order=CANCELLED + 402
```

> **Gap đã biết**: `CreateOrderHandler` chỉ tính `taxAmount`/`shippingFee` server-side, còn `unitPrice` của từng item vẫn lấy từ DTO đầu vào — bản thân Orders service không tự re-validate lại với giá gốc từ Product. Trong thực tế Gateway's `/cart/checkout` (flow khách hàng dùng) đã set `unitPrice` server-side từ Product trước khi gọi tới đây, nhưng endpoint `/orders` tạo trực tiếp thì không, nên vẫn còn khai thác được qua đường đó. Xem [project-roadmap.md](./project-roadmap.md) mục gap #6.

---

## 2. Transactional Outbox Pattern (Orders Service)

Đảm bảo event không bị mất kể cả khi service crash giữa chừng:

```
┌──────────────────────────────────────────────────────────────┐
│         Order Service (Create Order Transaction)             │
│                                                              │
│  (Transaction #2 của checkout, hoặc UpdateOrderStatus)       │
│  1. BEGIN TRANSACTION                                        │
│  2. UPDATE orders SET status = ...                           │
│  3. INSERT outbox (eventType='order.created' |               │
│                    'order.status_updated', payload={...})    │
│  4. COMMIT  (đổi trạng thái + ghi event: all-or-nothing)     │
└──────────────────────────────────────────────────────────────┘
          │
          │ OutboxWorker chạy @Cron('EVERY_SECOND')
          ▼
┌──────────────────────────────────────────────────────────────┐
│         Outbox Worker (Background Job)                       │
│                                                              │
│  1. SELECT * FROM outbox WHERE status='PENDING' LIMIT 20     │
│  2. VỚI MỖI row:                                             │
│     a. emit tới ORDER_TCP_CLIENT (trỏ chính Orders, không    │
│        có handler → bị bỏ)                                   │
│     b. emit tới NOTIFICATION_TCP_CLIENT                      │
│     c. UPDATE outbox SET status='PUBLISHED'                  │
│  3. Lỗi đồng bộ khi emit: retryCount++, ≥5 → 'FAILED'       │
└──────────────────────────────────────────────────────────────┘
```

Vì NestJS TCP không hỗ trợ broadcast, `OutboxWorker` phải tự loop qua nhiều `ClientProxy` (Order + Notification) để fan-out thủ công.

> **Giới hạn**: `emit` không có ack và row bị đánh dấu `PUBLISHED` ngay → at-most-once tới consumer; nhiều instance Orders sẽ phát trùng (không `SKIP LOCKED`). Chi tiết: [design-trade-offs.md §2.4](./design-trade-offs.md#24-transactional-outbox--polling-mỗi-giây).

---

## 3. Optimistic Locking (Product Stock Adjustment)

Tránh race condition khi nhiều request cùng trừ/cộng stock:

```typescript
// Product entity có @VersionColumn()
// Khi adjust stock:
// 1. Đọc Product (version=5, stock=100)
// 2. Sửa: stock=95
// 3. Save với WHERE version=5 (kiểm tra atomic)
// 4. NẾU version đã đổi (thread khác đã sửa):
//    → UPDATE fail với lỗi version mismatch
//    → Handler retry lại từ bước 1

// Kết quả: không overselling, không underselling
```

`AdjustStockHandler` retry 1 lần khi gặp `OptimisticLockVersionMismatchError`, nếu vẫn fail thì throw `RpcException`.

---

## 4. Pessimistic Locking (Promotion Voucher)

Tránh voucher bị dùng vượt `usageLimit` khi có nhiều request đồng thời:

```typescript
// Khi apply voucher:
// 1. SELECT * FROM vouchers WHERE id=... FOR UPDATE (row lock)
// 2. Kiểm tra: usageCount < usageLimit
// 3. Tăng: usageCount += 1
// 4. COMMIT (giải phóng lock)
//
// Kết quả: chỉ 1 thread giữ được lock tại 1 thời điểm
//          các thread khác phải chờ hoặc timeout
```

---

## 5. Data Flow: Ví dụ Checkout đầy đủ

Flow end-to-end khi user mua hàng:

```
1. CLIENT REQUEST (Browser)
   POST /cart/checkout
   Body: ShippingAddressDto { recipientName, recipientPhone, addressLine1, city, country, ... }
   (items lấy từ giỏ hàng Redis; Gateway snapshot unitPrice từ Product.GET_PRODUCT; chưa hỗ trợ voucher)
   Headers: Authorization: Bearer {accessToken}

   ↓ (HTTPS)

2. GATEWAY LAYER
   • HttpExceptionFilter: bắt mọi lỗi HTTP
   • RequestTracker: x-api-key + x-request-id; ThrottlerGuard
   • JwtAuthGuard: verify JWT qua USER_SERVICE.VERIFY_TOKEN (TCP)
   • CartController.checkout: đọc cart → lấy giá từ Product → Orders.CreateOrder → clearCart

   ↓ (TCP)

3. ORDER SERVICE - Saga Handler
   Step A: Trừ inventory (gọi "reserve" nhưng thực chất là ADJUST_STOCK với delta âm)
   ├─ Gọi: PRODUCT_SERVICE.ADJUST_STOCK({ productId, delta: -qty })
   ├─ Response: { success: true, newStock: ... }
   └─ NẾU FAIL: Throw error (gateway bắt → 400)

   Step B: Tạo order trong DB (transaction RIÊNG, không chung với Step A)
   ├─ INSERT orders (status='PENDING') + order_items (...)
   └─ COMMIT

   Step C: Charge payment
   ├─ Gọi: PAYMENT_SERVICE.CHARGE_PAYMENT({
   │    orderId,
   │    amount: 100.00,
   │    idempotencyKey: orderId,
   │  })
   ├─ Response: { transactionId, status: 'SUCCEEDED' }
   └─ NẾU response trả về FAIL: Compensate → PRODUCT_SERVICE.ADJUST_STOCK({ productId, delta: +qty }) + UPDATE order status='CANCELLED'

   Step D: Confirm order (transaction thứ 2)
   ├─ UPDATE orders SET status='PROCESSING'
   ├─ INSERT outbox (eventType='order.created', payload={orderId,userId,totalAmount})
   └─ COMMIT  (OutboxWorker sẽ nhặt row này)

   ↓ Response về Gateway

4. GATEWAY LAYER
   • HttpExceptionFilter: convert RPC result
   • TransformInterceptor: bọc response thành { success: true, data: order, ... }
   • Trả HTTP 201 Created

   ↓ (HTTPS)

5. CLIENT NHẬN RESPONSE
   {
     "success": true,
     "data": {
       "id": "order-uuid",
       "status": "PROCESSING",
       "items": [...],
       "totalAmount": 100.00
     }
   }

[BẤT ĐỒNG BỘ - OutboxWorker]

6. OUTBOX WORKER (chạy mỗi giây)
   • SELECT * FROM outbox WHERE status='PENDING' LIMIT 20
   • Đọc: { eventType: 'order.created', payload: order }
   • Emit qua TCP:
     ├─ Tới ORDER_SERVICE: { event: 'order.created', data: order }
     └─ Tới NOTIFICATION_SERVICE: { event: 'order.created', data: order }
   • UPDATE outbox SET status='PUBLISHED'

7. NOTIFICATION SERVICE - Event Listener
   @EventPattern('order.created') → onOrderCreated(order)
   • Lấy email user: USER_SERVICE.GET_USER_INFO({ userId })
   • Gửi email: EmailProvider.send(user.email, "Order confirmed")
   • Lưu: INSERT sent_notifications (...)

8. CLIENT (Browser)
   [Tuỳ chọn] Poll GET /orders/{orderId} → nhận status='PROCESSING'
```

### Sequence Diagram: Checkout Flow

```
Client          Gateway          Order Service       Product Service      Payment Service
  │                │                  │                   │                    │
  │─ POST /checkout (JWT)────────────>│                  │                     │
  │                │                  │                  │                     │
  │                │<─ JwtAuthGuard ──┤                  │                     │
  │                │   (verify token) │                  │                     │
  │                │                  │                  │                     │
  │                │<─ Create Order ──┤                  │                     │
  │                │                  │─ ADJUST_STOCK ───>│                     │
  │                │                  │  (delta âm)       │                     │
  │                │                  │<─ OK ────────────│                     │
  │                │                  │                  │                     │
  │                │                  │─ INSERT Order ───┤ (DB transaction #1) │
  │                │                  │  (PENDING)       │                     │
  │                │                  │                  │                     │
  │                │                  │─ Charge Payment ──────────────────────>│
  │                │                  │<─ Transaction ID ─────────────────────│
  │                │                  │                  │                     │
  │                │                  │─ UPDATE Order ───┤ (DB transaction #2) │
  │                │                  │  =PROCESSING + INSERT Outbox
  │                │<─ Order Object ──│                  │                     │
  │<─ 201 Created ─│                  │                  │                     │
  │  {order data}  │                  │                  │                     │
  │                │                  │                  │                     │
  │     [chạy nền, OutboxWorker mỗi 1s]                  │                     │
  │                │                  │                  │                     │
  │                │                  │<─ Poll Outbox ───┤                     │
  │                │                  │  (status=PENDING)│                     │
  │                │                  │                  │                     │
  │                │                  │─ Emit Event ─────────────────────────>│
  │                │                  │  (order.created) │                     │
  │                │                  │                  │                     │
  │     [Notification Service]        │                  │                     │
  │       (async event listener)      │                  │                     │
  │       → gửi email notification    │                  │                     │
  │                                   │                  │                     │
```

---

## Tài liệu liên quan

- [system-architecture.md](./system-architecture.md) — Tổng quan kiến trúc, sơ đồ hệ thống
- [business-flows.md](./business-flows.md) · [module-processing-flows.md](./module-processing-flows.md) · [design-trade-offs.md](./design-trade-offs.md)
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) — Login, verify token, refresh, logout
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) — Middleware chain Gateway
- [project-roadmap.md](./project-roadmap.md) — Các gap đã biết (price trust, refund compensation, v.v.)
