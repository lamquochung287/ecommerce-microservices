# Hướng dẫn cho AI Agents - Orders Module

## Vai trò
Microservice hybrid: TCP :3002 + Kafka (group `orders-service`). Cart (Redis), Order, Refund (hoàn hàng), **orchestrator** của checkout v2 (đồng bộ tới `payment_url`, sau đó điều phối bằng event/command qua Outbox -> Kafka), scheduler. **Bắt buộc CQRS**. Saga đồng bộ cũ (trừ kho -> charge -> PROCESSING) **đã bị xoá**.
Thiết kế: [docs/target-checkout-architecture.md](../../docs/target-checkout-architecture.md); luồng + rule: [docs/business-flows.md](../../docs/business-flows.md), [docs/system-architecture-orders-flow.md](../../docs/system-architecture-orders-flow.md), [docs/design-trade-offs.md](../../docs/design-trade-offs.md).

## Module con
`cart/` (Redis `cart:{userId}`, TTL `CART_TTL_SECONDS` mặc định 30 ngày, chỉ `{productId,quantity}`; `deductItems`) · `clients/` (`InventoryClient`, `PaymentClient`, `ProductClient`, `PromotionClient` — TCP, timeout 10s, bọc lỗi thành `RpcException` giữ nguyên `statusCode` + field phụ) · `pricing/` (`OrderPricingService`, `money.ts`) · `order-state/` (`OrderTransitionService`, `OrderCancellationService`, `return-window.ts`, `OrderVersionConflictError`) · `messaging/` (3 consumer Kafka mỏng) · `jobs/` (`OrderLifecycleScheduler`) · `commands|queries/` · `entities/` (Order, OrderItem, Refund; bảng `outbox`/`processed_messages` do `@lib/messaging` quản lý).

## TCP pattern (`ORDER_MESSAGE_PATTERN`, luôn gắn `Transport.TCP`)
`CHECKOUT {userId, dto}` · `GET_PAYMENT_LINK {orderId, userId}` · `CANCEL_ORDER {orderId, userId}` · `REQUEST_RETURN {orderId, userId, reason}` · `GET_ORDERS {userId?}` · `GET_ORDER {id}` · `GET_REFUNDS {orderId}` · cart (`CART_MESSAGE_PATTERN`). `userId` luôn do Gateway lấy từ token. Orders không có `ValidationPipe` ở biên TCP nên tự `plainToInstance + validateSync({whitelist:true})` (`dto/parse-dto.ts`, `CheckoutHandler`); field lạ bị loại, sai -> 400.

## State machine (`order-status.constant.ts`, dùng `canTransition`)
`PENDING_PAYMENT -> PAID -> FULFILLING -> SHIPPED -> DELIVERED -> COMPLETED`; huỷ: `PENDING_PAYMENT|PAID|FULFILLING -> CANCELLED` (`cancelReason`: `USER`, `PAYMENT_EXPIRED`, `PAYMENT_FAILED`, `REPLACED`, `RESERVATION_INVALID`, `INVENTORY_COMMIT_FAILED`, `SHIPMENT_FAILED`); hoàn hàng: `DELIVERED -> REFUNDING -> REFUNDED`. Terminal: `CANCELLED`, `REFUNDED`, `COMPLETED`. Không còn `PENDING`/`PROCESSING`.
**Mọi đổi trạng thái** đi qua `OrderTransitionService.transition(manager, order, to, patch, messages)`: `UPDATE orders SET ..., version = version+1 WHERE id AND version` + ghi Outbox (`OrderStatusChanged` tự động + `messages[]`) **cùng transaction**; 0 dòng = `OrderVersionConflictError` (409 "Đơn vừa thay đổi, hãy tải lại"). Request của user: không retry, trả 409. Consumer Kafka: để runner retry, mỗi lần **đọc lại đơn và kiểm lại `canTransition`**. Scheduler: bỏ qua đơn lệch version. Không dùng `save()` của TypeORM để đổi status.

## Checkout v2 (`CheckoutHandler`)
Gateway gửi `{items:[{productId}], shippingAddress, voucherCode?}`; số lượng lấy từ cart, giá từ Product (`variantId` -> 400, chưa hỗ trợ biến thể).
1. Pricing: `subtotal`, `tax=round(subtotal×ORDER_TAX_RATE[0.1])`, `ship=ORDER_SHIPPING_FEE_FLAT[30000]`; có `voucherCode` -> `Promotion.VALIDATE_VOUCHER(subtotal)` -> `discountAmount`; `total = subtotal + tax + ship − discount`.
2. Tìm đơn `PENDING_PAYMENT` của user có món trùng (`replaces`) -> `Inventory.RESERVE(orderId, items, ttl=ORDER_PAYMENT_TTL_SECONDS[900], replaces)`; hết hàng -> 409.
3. `Promotion.RESERVE_VOUCHER` (sau reserve kho; lỗi -> `Inventory.RELEASE` rồi ném lỗi gốc).
4. TX: insert Order `PENDING_PAYMENT` (`expiresAt`, `voucherCode`, `discountAmount`) + items + Outbox `OrderCreated`; huỷ các đơn `replaces` (`CANCELLED/REPLACED`, `CancelPaymentIntent`, `OrderCancelled{paid:false}`). TX lỗi -> release kho + voucher best-effort.
5. Chốt #1: `Inventory.CHECK_RESERVATION` phải `valid`, không thì huỷ đơn (409, không tạo intent). Rồi `Payment.CREATE_INTENT` (`idempotencyKey=orderId`, `expiresAt` = hạn giữ hàng); lỗi/timeout chỉ log (đơn vẫn `PENDING_PAYMENT`, user lấy lại link qua `GET_PAYMENT_LINK`).
Trả `{orderId, status, payment_url, expiresAt}`; `payment_url = ${PUBLIC_API_BASE_URL}/orders/{id}/pay`. **Không xoá cart** ở bước này.
`PreparePaymentHandler` (chốt #2, `GET_PAYMENT_LINK`): chủ đơn (khác user -> 404), `PENDING_PAYMENT`, chưa quá `expiresAt`, reservation còn `RESERVED` -> `{paymentUrl, expiresAt}` (tạo intent nếu chưa có); không đạt -> huỷ đơn + 409.

## Consumer Kafka (qua `KafkaConsumerRunner`: inbox + TX + retry 3 + DLQ)
- `payment-events`: `PaymentSucceeded` + `PENDING_PAYMENT` -> `PAID` (+`OrderPaid`, `CommitInventory`), trừ cart đúng món đã đặt (`afterCommit`, lỗi chỉ log); + `CANCELLED` (thanh toán muộn) -> `refundStatus=PENDING` + `RefundPayment` toàn bộ số đã thu (`LATE_PAYMENT`). `PaymentFailed` -> `CANCELLED(PAYMENT_FAILED)` + `ReleaseInventory` + `CancelPaymentIntent`. `PaymentRefunded/RefundFailed` -> cập nhật `refundStatus/refundedAmount/refundedAt` (đơn huỷ) hoặc `REFUNDING -> REFUNDED` + `RestockInventory` + Refund `COMPLETED` (hoàn hàng); idempotent theo trạng thái.
- `inventory-events`: `InventoryCommitted` + `PAID` -> `FULFILLING` + `CreateShipment`; đơn `CANCELLED` thì bỏ qua. `InventoryCommitFailed` -> `CANCELLED(INVENTORY_COMMIT_FAILED)` + `RefundPayment`.
- `shipping-events`: `ShipmentCreated` + `FULFILLING` -> `SHIPPED` (+`trackingCode`); đơn `CANCELLED` -> gửi `CancelShipment` bù trừ. `ShipmentDelivered` + `SHIPPED` -> `DELIVERED` (+`deliveredAt`). `ShipmentFailed` + `FULFILLING` -> `CANCELLED(SHIPMENT_FAILED)` + hoàn tiền + `RestockInventory`.

## Huỷ / hoàn hàng
- `CANCEL_ORDER`: `PENDING_PAYMENT` -> `cancelUnpaid(USER)` (release kho, `CancelPaymentIntent`, `OrderCancelled{paid:false}`, không hoàn tiền); `PAID|FULFILLING` -> `cancelPaid(USER)` (`refundStatus=PENDING`, `RefundPayment`, `RestockInventory`, `CancelShipment` nếu `FULFILLING`, `OrderCancelled{paid:true}`); `SHIPPED|DELIVERED|REFUNDING` -> 409; terminal -> 400; không phải chủ đơn -> 404.
- `REQUEST_RETURN`: chỉ `DELIVERED`, trong `ORDER_RETURN_WINDOW_DAYS` (7) kể từ `deliveredAt` (`now >= deliveredAt + window` coi là hết hạn) -> `REFUNDING` + Refund `PENDING` + `RefundPayment`; `COMPLETED` -> 400.
- Số tiền hoàn `refundAmountOf = totalAmount − shippingFee` (phí ship không hoàn, voucher không trả khi đã thanh toán). Luồng thanh toán muộn hoàn toàn bộ số đã thu.

## Scheduler (`OrderLifecycleScheduler`, `@nestjs/schedule`)
Mỗi 30 giây: `ExpirePendingOrders` (`PENDING_PAYMENT` quá `expiresAt` -> `CANCELLED(PAYMENT_EXPIRED)`); mỗi 10 phút: `CompleteDeliveredOrders` (`DELIVERED` quá cửa sổ đổi trả -> `COMPLETED`; `REFUNDING` không bị đụng). Batch 100, mỗi đơn 1 TX đọc lại + kiểm lại điều kiện, lệch version -> bỏ qua, có cờ chống chạy chồng. Nhiều instance vẫn an toàn nhờ optimistic lock (chỉ tốn công trùng).

## Quy tắc
- Event/command ra ngoài **chỉ** qua `OutboxWriter.append(manager, ...)` cùng transaction với đổi state (key luôn = orderId). Không `emit` trực tiếp, không `EventBus` cho liên-service.
- Hybrid app: gắn `Transport.TCP` cho `@MessagePattern`, `Transport.KAFKA` cho `@EventPattern`; `main.ts` gọi `ensureKafkaTopics` trước `startAllMicroservices` (Kafka tắt lúc boot = exit 1).
- Mọi tiền: `decimal` -> ép `Number()` khi tính; làm tròn 2 số (`money.ts`). Gọi service khác luôn có `timeout()` (10s). Lỗi nghiệp vụ = `RpcException({statusCode, message})`.
- Spec cần `jest.mock('../../cart/cart.service')` (kéo `@lib/cached` -> ESM) và `jest.mock('@nestjs/schedule', ...)` cho scheduler.

## Gotchas
- Crash sau `Inventory.RESERVE`/`RESERVE_VOUCHER` nhưng trước TX tạo đơn: kho tự hết hạn (job Inventory), lượt voucher bị giữ vĩnh viễn. `Inventory.RESERVE` trả luôn phần giữ của đơn `replaces`; nếu sau đó voucher/TX lỗi thì đơn cũ còn `PENDING_PAYMENT` nhưng mất reservation (chốt #2 hoặc scheduler huỷ khi tới).
- `PaymentRefundFailed` ở luồng hoàn hàng: đơn kẹt `REFUNDING`, chỉ có log error (admin xử lý tay); ở luồng huỷ -> `refundStatus=FAILED`.
- `GetOrders` không `userId` trả toàn bộ, không phân trang; `GET_ORDER` không kiểm tra chủ sở hữu (Gateway `GET /orders*` cũng không).
- Kafka consumer `fromBeginning:false`: khởi động Orders trước khi Payment/Inventory/Shipping phát event đầu tiên. **F1**: message phát khi Orders đang down có thể bị bỏ nếu partition chưa có offset commit (đã tái hiện: `CreateShipment` lúc Shipping tắt → đơn kẹt `FULFILLING`). Chưa có reconcile; xem [design-trade-offs.md §5 R20](../../docs/design-trade-offs.md).
- Đã kiểm chứng trên Postgres + Kafka thật: `checkout.int-spec.ts` (replaces, voucher), `order-transition.int-spec.ts` (khoá lạc quan), `order-cancel-race.int-spec.ts`; E2E E-01…E-13 PASS (`plans/261015-1700-checkout-v2-event-driven/reports/e2e-test-report.md`). Chưa kiểm: E-14 (Kafka tắt).
