# Hướng dẫn cho AI Agents - Shipping Module

## Vai trò
Microservice :3009 sở hữu vận đơn (`shipments`, mỗi đơn tối đa một dòng, `orderId` unique). **CQRS**. Hybrid app: `NestFactory.create` + `connectMicroservice(TCP)` + `connectMicroservice(KAFKA)` (không listen HTTP). Carrier là **mô phỏng** (`SimulatedShippingProvider`), thay bằng carrier thật qua token DI `SHIPPING_PROVIDER`. Thiết kế: [docs/target-checkout-architecture.md](../../docs/target-checkout-architecture.md) §6, §7, §10.1.

## Kafka
Consumer group `shipping-service` nghe `shipping-commands` (`ShippingCommandsConsumer`, `@EventPattern(..., Transport.KAFKA)`), xử lý qua `KafkaConsumerRunner` (inbox + transaction + retry `KAFKA_CONSUMER_MAX_ATTEMPTS`=3 + DLQ `shipping-commands.dlq`), phát event qua `OutboxWriter` (`source=shipping`, topic `shipping-events`, key = orderId).

| Command | Trạng thái hiện tại | Hành động | Outbox |
|---|---|---|---|
| `CreateShipment` | không có | gọi carrier, insert `CREATED` | `ShipmentCreated{trackingCode}` |
| | có (mọi status) | no-op, carrier không bị gọi lại | - |
| | carrier lỗi 3 lần | DLQ, TX riêng insert `FAILED` | `ShipmentFailed{reason}` |
| `CancelShipment` | `CREATED` | carrier.cancel + `CANCELLED` | - |
| | không có / `FAILED` / `CANCELLED` | no-op | - |
| | `DELIVERED` | log warn, không đổi | - |

- Hẹn giờ giao (`SHIPPING_SIM_DELIVER_DELAY_MS>0`) chỉ được đặt sau khi TX tạo vận đơn commit (`afterCommit` của runner).
- Hết lượt retry: `markFailed` ghi inbox + vận đơn `FAILED` + `ShipmentFailed` trong một TX riêng; nếu lỗi thì runner ném để Kafka giao lại message.
- Type lạ: log warn, inbox vẫn ghi, không DLQ. `main.ts` gọi `ensureKafkaTopics` trước khi start.

## Pattern TCP (`SHIPPING_MESSAGE_PATTERN`, luôn gắn `Transport.TCP`)
- `HANDLE_WEBHOOK {payload:{eventId, orderId, trackingCode, status:'DELIVERED', deliveredAt}, signature}`: verify HMAC-SHA256 (`SHIPPING_WEBHOOK_SECRET`, `timingSafeEqual`, ký trên `JSON.stringify(payload)`) -> sai 400; kiểm schema payload (400); inbox `(shipping-webhook, eventId)` trùng -> `{alreadyProcessed:true}`; shipment `CREATED` -> `DELIVERED` + outbox `ShipmentDelivered{deliveredAt}`; trạng thái khác -> no-op; không có shipment -> 404.
- `SIMULATE_DELIVERY {orderId}`: `NODE_ENV=production` -> 404; ngược lại dựng payload `eventId` = UUID tất định từ `shipmentId` (`simulatedDeliveryEventId`, cột inbox là uuid), ký, chạy `HandleShippingWebhook` (cùng đường verify).
- `GET_SHIPMENT {orderId}`: trả vận đơn hoặc 404.

## Env
`SHIPPING_WEBHOOK_SECRET` (bắt buộc), `SHIPPING_SIM_MODE` (`success`|`fail`, mặc định `success`; `fail` làm carrier luôn lỗi để thử DLQ), `SHIPPING_SIM_DELIVER_DELAY_MS` (mặc định 0 = chỉ giao tay), `NODE_ENV`.

## Lưu ý
- Timer giao hàng nằm trong bộ nhớ, mất khi restart; `SIMULATE_DELIVERY` vẫn kích hoạt tay được.
- Carrier được gọi trong TX của runner (chấp nhận với simulator); carrier thật nên gọi ngoài TX rồi mới ghi.
- Cần `KAFKA_BROKERS` trong `.env`; khởi động Shipping trước khi Orders relay `CreateShipment` (`fromBeginning:false`). F1: `CreateShipment` phát lúc Shipping đang down có thể bị bỏ, đơn kẹt `FULFILLING` (đã tái hiện E2E, xem [design-trade-offs.md §5 R20](../../docs/design-trade-offs.md)).
- `eventId` của webhook giao hàng phải là UUID (sai → 400). Lý do: cột `processed_messages.eventId` là `uuid`.
- Đã kiểm chứng: `shipping.int-spec.ts` (5/5) trên Postgres; E2E E-03, E-11.
