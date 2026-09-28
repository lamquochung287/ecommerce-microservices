# System Architecture — Orders Flow

**Ngày cập nhật**: 2026-09-28

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả chi tiết các pattern nghiệp vụ trong Orders service: Checkout Saga, Transactional Outbox, Optimistic/Pessimistic Locking, và flow checkout đầy đủ end-to-end.

---

## 1. Checkout Saga Pattern (Orders Service)

Saga phân tán điều phối flow checkout phức tạp, có compensation logic khi bước nào đó fail.

> **Quan trọng**: Product service **không có** RPC riêng cho "reserve" hay "release" stock — chỉ có **1 message pattern duy nhất `ADJUST_STOCK`** nhận `{ productId, delta }`. "Reserve" = gọi `ADJUST_STOCK` với `delta` âm (trừ ngay lập tức, không phải giữ chỗ tạm thời); "Release" (compensation) = gọi lại chính pattern đó với `delta` dương để cộng trả lại. Đây là điểm dễ bị hỏi xoáy trong phỏng vấn: **không có khái niệm "reservation" tách biệt khỏi số dư thực** — nếu muốn true 2-phase reservation (hold riêng, confirm/release sau) thì cần thêm state (vd: cột `reservedStock` riêng), hiện tại chưa có.

```
Step 1: Reserve Inventory (thực chất là trừ stock ngay)
├─ Gọi: PRODUCT_MESSAGE_PATTERN.ADJUST_STOCK, delta = -quantity
├─ Input: { productId, delta: -quantity }
└─ Output: { success, newStock } (hoặc lỗi nếu không đủ hàng)
   └─ NẾU FAIL giữa chừng (nhiều item): [Compensation] gọi lại ADJUST_STOCK với delta dương cho các item đã trừ trước đó

Step 2: Create Order in DB (TRANSACTION RIÊNG, tách khỏi Step 1)
├─ Action: INSERT Order (status=PENDING) + OrderItems
├─ Action: INSERT Outbox row (eventType='order.created')
└─ Transaction: cả 2 cùng thành công hoặc cùng fail
   └─ ⚠️ Gap: nếu crash giữa Step 1 và Step 2, stock đã bị trừ vĩnh viễn nhưng chưa có Order/Outbox nào được tạo để trigger compensation — xem mục "Gap chưa được xử lý" bên dưới

Step 3: Charge Payment
├─ Gọi: Payment.CHARGE_PAYMENT với idempotencyKey=orderId
├─ Input: { orderId, amount, idempotencyKey }
└─ Output: { transactionId, status }
   ├─ NẾU response trả về SUCCESS: [Next Step] Cập nhật order status
   └─ NẾU response trả về FAIL (rõ ràng): [Compensation] Release inventory (ADJUST_STOCK delta dương) + Cancel order
   └─ ⚠️ Gap: nếu TCP call chính nó timeout/exception (không phải response fail), lỗi propagate lên KHÔNG được catch — inventory không được release, order kẹt ở PENDING

Step 4: Confirm & Publish Event
├─ Action: UPDATE Order (status=PROCESSING)
├─ Action: Outbox đã được insert ở Step 2
└─ OutboxWorker sẽ fan-out event tới Notification
```

**Tính chất quan trọng**:
- **Atomicity**: Step 2 & 4 là DB transaction (thành công cùng nhau hoặc fail cùng nhau) — nhưng Step 1 (trừ stock) KHÔNG cùng transaction với Step 2, vì nó là 1 TCP call ra service khác
- **Idempotency**: `Payment.CHARGE_PAYMENT` dùng `idempotencyKey=orderId` để tránh charge 2 lần khi retry
- **Compensation**: chỉ trigger khi nhận được response fail rõ ràng từ Payment, không bắt được trường hợp timeout/exception (xem gap ở Step 3)

### Gap chưa được xử lý (điểm hay bị hỏi trong phỏng vấn)

1. **Failure window giữa Step 1 và Step 2**: nếu process crash sau khi đã gọi `ADJUST_STOCK` (trừ stock) nhưng trước khi transaction tạo Order commit xong, stock bị trừ vĩnh viễn mà không có Order nào tồn tại để biết cần hoàn lại — không có outbox event, không ai theo dõi được. Đây là hệ quả của việc dùng nhiều transaction riêng biệt (DB tx + TCP call) thay vì 1 unit of work thực sự — trade-off cố hữu của distributed saga so với transaction đơn.
2. **Payment TCP timeout/exception không được compensate**: `CreateOrderHandler` chỉ compensate khi `paymentProvider.capture()` trả về `{ success: false }`. Nếu bản thân lời gọi TCP đó bị timeout hoặc throw exception (Payment service down, network drop), exception sẽ propagate lên mà không được catch trong logic compensation — stock đã reserve (trừ) trước đó không được release, đơn hàng kẹt ở PENDING.
3. **Outbox `FAILED` sau khi hết retry**: `OutboxWorker` đánh dấu row là `FAILED` sau 5 lần retry, nhưng hiện chưa có cơ chế alerting hay tool replay thủ công cho các row này — nếu bị hỏi "làm sao biết event bị mất", câu trả lời trung thực là: hiện tại phải query trực tiếp bảng `outbox WHERE status='FAILED'`.

**Sơ đồ flow**:
```
Request → Reserve Stock ──OK──> Create Order ──OK──> Charge Payment ──OK──> Confirm
               │                                            │
               FAIL ◄─── FAIL ──────────── Cancel ◄── FAIL ◄─ Release Stock
                           (Compensation)
```

> **Gap đã biết**: `CreateOrderHandler` chỉ tính `taxAmount`/`shippingFee` server-side, còn `unitPrice` của từng item vẫn lấy từ DTO đầu vào — bản thân Orders service không tự re-validate lại với giá gốc từ Product. Trong thực tế Gateway's `/cart/checkout` (flow khách hàng dùng) đã set `unitPrice` server-side từ Product trước khi gọi tới đây, nhưng endpoint `/orders` tạo trực tiếp thì không, nên vẫn còn khai thác được qua đường đó. Xem [project-roadmap.md](./project-roadmap.md) mục gap #6.

---

## 2. Transactional Outbox Pattern (Orders Service)

Đảm bảo event không bị mất kể cả khi service crash giữa chừng:

```
┌──────────────────────────────────────────────────────────────┐
│         Order Service (Create Order Transaction)             │
│                                                              │
│  1. BEGIN TRANSACTION                                        │
│  2. INSERT orders (status=PENDING)                           │
│  3. INSERT order_items (...)                                 │
│  4. INSERT outbox (eventType='order.created', payload={...}) │
│  5. COMMIT                                                   │
│     ↓                                                         │
│     Hoặc TẤT CẢ thành công (commit) hoặc TẤT CẢ fail (rollback) │
└──────────────────────────────────────────────────────────────┘
          │
          │ OutboxWorker chạy @Cron('EVERY_SECOND')
          ▼
┌──────────────────────────────────────────────────────────────┐
│         Outbox Worker (Background Job)                       │
│                                                              │
│  1. SELECT * FROM outbox WHERE status='PENDING' LIMIT 20     │
│  2. VỚI MỖI row:                                             │
│     a. Emit event qua TCP tới Order service                  │
│     b. Emit event qua TCP tới Notification service           │
│     c. UPDATE outbox SET status='PUBLISHED'                  │
│  3. NẾU retryCount >= 5 → SET status='FAILED'                │
└──────────────────────────────────────────────────────────────┘
```

Vì NestJS TCP không hỗ trợ broadcast, `OutboxWorker` phải tự loop qua nhiều `ClientProxy` (Order + Notification) để fan-out thủ công.

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
   POST /orders/checkout
   Body: {
     items: [{ productId, quantity }, ...],
     shippingAddressId,
     voucherId (optional)
   }
   Headers: Authorization: Bearer {accessToken}

   ↓ (HTTPS)

2. GATEWAY LAYER
   • HttpExceptionFilter: bắt mọi lỗi HTTP
   • JwtAuthGuard: verify JWT qua USER_SERVICE.VERIFY_TOKEN (TCP)
   • PermissionGuard: check user.permissions bitmask
   • ValidationPipe: validate CreateOrderDto

   ↓ (TCP)

3. ORDER SERVICE - Saga Handler
   Step A: Trừ inventory (gọi "reserve" nhưng thực chất là ADJUST_STOCK với delta âm)
   ├─ Gọi: PRODUCT_SERVICE.ADJUST_STOCK({ productId, delta: -qty })
   ├─ Response: { success: true, newStock: ... }
   └─ NẾU FAIL: Throw error (gateway bắt → 400)

   Step B: Tạo order trong DB (transaction RIÊNG, không chung với Step A)
   ├─ INSERT orders (status='PENDING')
   ├─ INSERT order_items (...)
   ├─ INSERT outbox (eventType='order.created', payload=order)
   └─ COMMIT (all-or-nothing)

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
   ├─ Outbox row từ Step B sẽ được OutboxWorker nhặt lên
   └─ COMMIT

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
       "totalPrice": 100.00
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
  │                │                  │─ INSERT Order ───┤ (DB transaction)    │
  │                │                  │  + INSERT Outbox │                     │
  │                │                  │                  │                     │
  │                │                  │─ Charge Payment ──────────────────────>│
  │                │                  │<─ Transaction ID ─────────────────────│
  │                │                  │                  │                     │
  │                │                  │─ UPDATE Order ───┤ (DB transaction)    │
  │                │                  │  status=PROCESSING
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
- [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) — Login, verify token, refresh, logout
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) — Middleware chain Gateway
- [project-roadmap.md](./project-roadmap.md) — Các gap đã biết (price trust, refund compensation, v.v.)
