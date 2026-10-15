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
PENDING→{PROCESSING,CANCELLED} · PROCESSING→{PAID,CANCELLED} · PAID→{SHIPPED,CANCELLED} · SHIPPED→DELIVERED · DELIVERED→REFUNDED · CANCELLED/REFUNDED cuối. `UpdateOrderStatus` = 1 transaction (đổi status + Outbox `order.status_updated`). `PaymentEventsController` nghe `payment_succeeded` → `ConfirmOrderPaymentCommand` tự chuyển PROCESSING→PAID qua `UpdateOrderStatus` (event có thể tới khi đơn còn PENDING nên chờ thử lại tối đa ~3s; đơn đã PAID trở đi thì bỏ qua; đơn CANCELLED chỉ log cảnh báo cần hoàn tiền thủ công). `payment_failed` chỉ log vì Saga đã hoàn kho + CANCELLED đồng bộ. Lỗi từ Product (vd 409 hết hàng) được `InventoryReservationService` bọc lại thành `RpcException` để Gateway trả đúng mã. Cancel thủ công **không** hoàn kho/tiền.

## Refund
Tạo khi order ∈ {PAID,SHIPPED,DELIVERED}; Σ refund không-REJECTED + amount ≤ `totalAmount`. Approve (transaction): PENDING→COMPLETED, đủ tổng & `canTransition→REFUNDED` thì Order=REFUNDED. Reject: PENDING→REJECTED. Chưa hoàn tiền thật/hoàn kho; chưa lock chống race.

## OutboxWorker
`@Cron` mỗi giây, 20 row `PENDING`/lần, `emit` tới Notification, đánh dấu `PUBLISHED` ngay → **at-most-once**; `retryCount` ≥5 → `FAILED` (không alert/replay). Thêm subscriber = thêm `ClientProxy` vào `subscribers`. Nhiều instance → phát trùng.

## Quy tắc
- Event ra ngoài phải đi **Outbox cùng transaction** với thay đổi state, không `emit` trực tiếp trong handler.
- Mọi tiền: `decimal` → ép `Number()` khi tính; làm tròn 2 số.
- Gọi service khác luôn có `timeout()` (10s). Mọi lỗi nghiệp vụ = `RpcException({statusCode, message})`.

## Gotchas
- Orders **tin `unitPrice` và `userId` trong DTO** (an toàn chỉ khi đi qua `/cart/checkout`). Khi sửa: tự lấy giá từ Product.
- Cửa sổ lỗi: crash sau reserve → kho mất; charge OK nhưng timeout → đơn bị huỷ dù đã trừ tiền; chưa có job quét `PENDING`.
- `GetOrders` không `userId` trả toàn bộ, không phân trang. Order không lưu transactionId.
- `OrderCreatedHandler` chỉ `console.log`.
- Voucher (checkout v2): `OrderPricingService` gọi `Promotion.VALIDATE_VOUCHER` (subtotal) -> `total = subtotal + tax + ship − discount`; `CheckoutHandler` gọi `RESERVE_VOUCHER` SAU `Inventory.RESERVE` (lỗi -> `Inventory.RELEASE` + ném lỗi gốc; TX lỗi -> release kho và voucher best-effort). `voucherCode`/`discountAmount` lưu trên Order; `OrderPaid`/`OrderCancelled` mang `voucherCode`; chỉ `OrderCancelled{paid:false}` (huỷ/hết hạn/bị thay thế) trả lượt, đơn đã thanh toán thì không. `refundAmountOf = totalAmount − shippingFee`. Crash giữa RESERVE_VOUCHER và TX tạo đơn làm lượt bị giữ vĩnh viễn (chấp nhận).
