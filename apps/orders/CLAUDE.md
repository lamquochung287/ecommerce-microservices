# Hướng dẫn cho AI Agents - Orders Module

## Vai trò
Microservice TCP :3002: Cart (Redis), Order, Refund, Checkout Saga, Transactional Outbox. **Bắt buộc CQRS**.
Chi tiết: [docs/business-flows.md §2.4–2.6](../../docs/business-flows.md), [docs/system-architecture-orders-flow.md](../../docs/system-architecture-orders-flow.md), [docs/design-trade-offs.md §2](../../docs/design-trade-offs.md).

## Module con
`cart/` (Redis `cart:{userId}`, TTL 30 ngày, chỉ `{productId,quantity}`) · `saga/` (`InventoryReservationService` → Product, `TcpPaymentProvider` → Payment) · `outbox/` (`OutboxWorker`) · `commands|queries|events/` · `entities/` (Order, OrderItem, Refund, Outbox).

## CreateOrderHandler (Saga, không có transaction bao trùm)
`subtotal=Σqty×unitPrice`; `tax=round(subtotal×ORDER_TAX_RATE[0.1])`; `ship=ORDER_SHIPPING_FEE_FLAT[30000]`.
1. **Reserve**: `ADJUST_STOCK(-qty)` tuần tự; 1 item lỗi → hoàn các item đã trừ rồi ném lỗi gốc.
2. **Tx#1**: Order `PENDING` + items (snapshot giá + địa chỉ).
3. **Charge**: `Payment.CHARGE_PAYMENT {orderId, amount, idempotencyKey=orderId}`. `success=false` **hoặc** lỗi/timeout TCP (provider đã bắt) → release stock (best-effort) + Order `CANCELLED` + `RpcException 402`.
4. **Tx#2**: Order `PROCESSING` + ghi Outbox `order.created`.

## State machine (`order-status.constant.ts`, dùng `canTransition`)
PENDING→{PROCESSING,CANCELLED} · PROCESSING→{PAID,CANCELLED} · PAID→{SHIPPED,CANCELLED} · SHIPPED→DELIVERED · DELIVERED→REFUNDED · CANCELLED/REFUNDED cuối. `UpdateOrderStatus` = 1 transaction (đổi status + Outbox `order.status_updated`). **Không có code tự chuyển PROCESSING→PAID** (Orders chưa nghe `payment_succeeded`). Cancel thủ công **không** hoàn kho/tiền.

## Refund
Tạo khi order ∈ {PAID,SHIPPED,DELIVERED}; Σ refund không-REJECTED + amount ≤ `totalAmount`. Approve (transaction): PENDING→COMPLETED, đủ tổng & `canTransition→REFUNDED` thì Order=REFUNDED. Reject: PENDING→REJECTED. Chưa hoàn tiền thật/hoàn kho; chưa lock chống race.

## OutboxWorker
`@Cron` mỗi giây, 20 row `PENDING`/lần, `emit` tới Orders-chính-nó (không handler) + Notification, đánh dấu `PUBLISHED` ngay → **at-most-once**; `retryCount` ≥5 → `FAILED` (không alert/replay). Thêm subscriber = thêm `ClientProxy` vào `subscribers`. Nhiều instance → phát trùng.

## Quy tắc
- Event ra ngoài phải đi **Outbox cùng transaction** với thay đổi state, không `emit` trực tiếp trong handler.
- Mọi tiền: `decimal` → ép `Number()` khi tính; làm tròn 2 số.
- Gọi service khác luôn có `timeout()` (10s). Mọi lỗi nghiệp vụ = `RpcException({statusCode, message})`.

## Gotchas
- Orders **tin `unitPrice` và `userId` trong DTO** (an toàn chỉ khi đi qua `/cart/checkout`). Khi sửa: tự lấy giá từ Product.
- Cửa sổ lỗi: crash sau reserve → kho mất; charge OK nhưng timeout → đơn bị huỷ dù đã trừ tiền; chưa có job quét `PENDING`.
- `GetOrders` không `userId` trả toàn bộ, không phân trang. Voucher chưa tích hợp. Order không lưu transactionId/discount.
- `OrderCreatedHandler` chỉ `console.log`.
