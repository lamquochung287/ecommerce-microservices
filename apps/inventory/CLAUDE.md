# Hướng dẫn cho AI Agents - Inventory Module

## Vai trò
Microservice :3008 sở hữu tồn kho (`stock_items`) và giữ hàng theo đơn (`reservations`). **CQRS**. Hybrid app: `NestFactory.create` + `connectMicroservice(TCP)` (không listen HTTP). Thiết kế: [docs/target-checkout-architecture.md §9](../../docs/target-checkout-architecture.md).

## Pattern TCP (`INVENTORY_MESSAGE_PATTERN`, luôn gắn `Transport.TCP`)
- `RESERVE {orderId, items:[{productId, variantId?, quantity}], ttlSeconds, replaces?}` -> `{orderId, status:'RESERVED', expiresAt}`; thiếu hàng -> 409 kèm `productIds`.
- `CHECK_RESERVATION {orderId}` -> `{valid, status, expiresAt}`; `valid = RESERVED && now < expiresAt`; không có -> `{valid:false, status:'NOT_FOUND'}`.
- `RELEASE {orderId}` idempotent (chỉ tác dụng khi `RESERVED`).
- `ADJUST_STOCK {productId, variantId?, delta}` upsert; `onHand+delta < reserved` hoặc `< 0` -> 409.
- `GET_AVAILABILITY {productIds[<=200]}` -> `[{productId, available}]` (dòng cấp sản phẩm, thiếu = 0).

## Quy tắc reserve (1 transaction)
1. Reservation của `orderId` đã có: `RESERVED` -> trả lại; khác -> 409 (không hồi sinh).
2. Khoá reservation `replaces` đang `RESERVED`; gộp số lượng theo `(productId, variantId)`.
3. Khoá MỌI `stock_items` liên quan (mới + của đơn bị thay) bằng một câu `ORDER BY id FOR UPDATE` -> không deadlock.
4. Kiểm tra toàn bộ `onHand - (reserved - phần đơn cũ trả) >= q` TRƯỚC khi ghi; thiếu -> 409, không ghi gì.
5. Trả phần đơn cũ (`RELEASED`), `reserved += q`, insert reservation.

`ReservationService` nhận `EntityManager` của transaction đang chạy (không tự mở transaction) để consumer dùng lại.

## Kafka
Consumer group `inventory-service` nghe `inventory-commands` (`InventoryCommandsConsumer`, `@EventPattern(..., Transport.KAFKA)`), xử lý qua `KafkaConsumerRunner` (inbox + transaction + retry 3 + DLQ `inventory-commands.dlq`) rồi phát event qua `OutboxWriter` (`source=inventory`, topic `inventory-events`, key = orderId; relay của `MessagingModule`).

| Command | Reservation | Hành động | Outbox |
|---|---|---|---|
| `CommitInventory` | RESERVED (kể cả hơi quá `expiresAt`) | `onHand-=q`, `reserved-=q`, COMMITTED | `InventoryCommitted` |
| | COMMITTED | no-op | `InventoryCommitted` (phát lại) |
| | RELEASED/EXPIRED/RESTOCKED/không có | no-op | `InventoryCommitFailed{reason: RESERVATION_<STATUS>\|RESERVATION_NOT_FOUND}` |
| `ReleaseInventory` | RESERVED | `reserved-=q`, RELEASED | - |
| `RestockInventory` | RESERVED | như Release | - |
| | COMMITTED | `onHand+=q`, RESTOCKED | - |

- Orders gửi `RestockInventory` cùng partition key `orderId` với `CommitInventory` nên thứ tự được giữ; Restock tới khi còn RESERVED chỉ release, Commit tới sau ra `InventoryCommitFailed`.
- Type lạ: log warn, inbox vẫn ghi, không DLQ. Lỗi kỹ thuật (vd mất dòng kho): throw trong transaction -> runner retry -> DLQ, không phát event bù.
- `main.ts` gọi `ensureKafkaTopics` trước khi start (broker tắt auto-create); cần `KAFKA_BROKERS` trong `.env`.

## Job
`ReservationExpiryJob` mỗi 30s: `RESERVED` quá `expiresAt + INVENTORY_EXPIRY_GRACE_SECONDS` (mặc định 60) -> `EXPIRED`, trả `reserved`. Mỗi reservation 1 transaction, `FOR UPDATE SKIP LOCKED`, batch 100.

## Gotchas
- Ràng buộc DB `CHECK (reserved >= 0 AND onHand >= reserved)` và unique `(productId, variantId) NULLS NOT DISTINCT` (PG15) chỉ có trong migration `AddInventoryTables`, không có trong entity.
- Migration sao chép `stock` từ Product một lần (`ON CONFLICT DO NOTHING`); Product vẫn giữ cột `stock` của nó tới khi chuyển hẳn sang Inventory, nên tồn kho có hai nguồn trong giai đoạn chuyển tiếp. `scripts/seed.ts` đồng bộ lại `stock_items` sau khi seed.
- `expiresAt` dùng `timestamptz` và so sánh bằng tham số `Date` từ app (không dùng `now()` trong SQL) để không lệch múi giờ.
- Lỗi nghiệp vụ là `RpcException({statusCode, message})`; `InventoryRpcExceptionFilter` xử lý phần còn lại.
- Trạng thái `RESTOCKED` đã khai báo sẵn trong enum cho luồng nhập lại kho sau commit.
