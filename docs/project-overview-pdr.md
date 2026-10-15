# Tổng quan Dự án - Product Development Requirements (PDR)

**Ngày cập nhật**: 2026-10-15
**Trạng thái**: Early-stage. Phase 0/1/2 xong; checkout v2 (event-driven) đã cutover ở mức code. Đã kiểm chứng trên stack thật: migration và int-spec trên Postgres + Kafka, E2E E-01…E-13. Chưa kiểm chứng: E-14 (Kafka outage), k6 load test sau cutover.

---

## 1. Mô tả dự án

Hệ thống **Ecommerce Microservices** là nền tảng thương mại điện tử theo kiến trúc microservices bằng NestJS (monorepo). Dự án phục vụ mục đích học tập về các nguyên lý backend phân tán:

- **Giao tiếp**: RPC đồng bộ qua TCP (`@nestjs/microservices`); event/command bất đồng bộ qua Kafka (Transactional Outbox → relay at-least-once → Inbox).
- **Nhất quán dữ liệu**: optimistic lock (`version`), pessimistic lock (voucher, kho), state machine đơn, idempotency.
- **Orchestration**: Orders điều phối checkout → thanh toán → giữ/trừ kho → vận chuyển → giao hàng bằng event/command.
- **Vận hành**: health check, graceful shutdown, circuit breaker, OpenTelemetry (Jaeger), Prometheus, Grafana.

Dự án chạy trên **localhost** (Docker Compose). Không dùng AWS hay hosting công cộng. Thanh toán và vận chuyển là **simulator**; email và push là simulated provider.

---

## 2. Kiến trúc: 10 ứng dụng

| App | Cổng | Vai trò | Kafka |
|---|---|---|---|
| `gateway` | HTTP 3000 | Entry duy nhất: auth, RBAC, throttle, idempotency, simulator | — |
| `user` | TCP 3001 | Đăng ký/đăng nhập, JWT session, role, địa chỉ | — |
| `orders` | TCP 3002 | Giỏ hàng, checkout v2, state machine, huỷ/hoàn, scheduler | Có (group `orders-service`) |
| `product` | TCP 3003 | Catalog: product, brand, attribute, variant (không có tồn kho) | — |
| `payment` | TCP 3004 | Payment intent, webhook HMAC, hoàn tiền, simulator | Có (`payment-service`) |
| `notification` | TCP 3005 | Email theo sự kiện đơn hàng (consumer, không phát event) | Có (`notification-service`) |
| `review` | TCP 3006 | Đánh giá có kiểm tra đã mua | — |
| `promotion` | TCP 3007 | Voucher: validate, giữ lượt, xác nhận, trả lượt | Có (`promotion-service`, consumer) |
| `inventory` | TCP 3008 | Tồn kho `stock_items`, giữ hàng `reservations` | Có (`inventory-service`) |
| `shipping` | TCP 3009 | Vận đơn, carrier mô phỏng, webhook giao hàng | Có (`shipping-service`) |

Chi tiết port và giao tiếp: [system-architecture.md](./system-architecture.md). Các app không có Kafka chỉ dùng TCP.

---

## 3. Miền nghiệp vụ

### 3.1 Xác thực và người dùng (`apps/user`, `apps/gateway`)
- Đăng ký (bcrypt), đăng nhập (access 15 phút + refresh 7 ngày, session trong Redis), xác thực mỗi request qua `VERIFY_TOKEN`, đăng xuất (xoá session).
- RBAC bitmask: `Module | Action`, quyền = OR các role. User mới chưa có role nên chưa gọi được API cần quyền.
- Sổ địa chỉ (`/addresses`). Avatar lưu MinIO.
- Chưa có refresh endpoint. Gap: logout không cần JWT; địa chỉ và đơn chưa kiểm chủ sở hữu ở một số route.

### 3.2 Catalog sản phẩm (`apps/product`)
- CRUD product, brand, attribute, variant (SKU unique). Product dùng CQRS.
- **Không còn tồn kho** trong Product. Cột `stock` đã bỏ bằng migration. Gateway ghép `available` và `stockStatus` (`IN_STOCK | OUT_OF_STOCK | UNKNOWN`) từ Inventory bằng một lần gọi theo danh sách id. Inventory lỗi hoặc chậm (>1.5 giây) thì trả `UNKNOWN`, không làm lỗi danh sách.
- Chưa có cache Redis cho catalog. Tìm kiếm `ILIKE` chưa có index.

### 3.3 Tồn kho và giữ hàng (`apps/inventory`)
- `stock_items` (`onHand`, `reserved`) và `reservations` (`RESERVED | COMMITTED | RELEASED | EXPIRED | RESTOCKED`).
- Checkout **giữ** hàng 15 phút (reserve), chỉ **trừ thật** khi thanh toán xong (commit). Đơn bỏ dở, hết hạn hoặc huỷ thì nhả hàng.
- Atomic: giữ đủ mọi món hoặc không món nào. Khoá theo thứ tự id để không deadlock. CHECK ở DB chặn oversell.
- Điều chỉnh tồn kho thủ công: `POST /products/:id/stock-adjustments` (quyền `PRODUCT|UPDATE`).

### 3.4 Giỏ hàng, đơn hàng và checkout (`apps/orders`, `apps/gateway`)
- **Giỏ hàng** lưu Redis `cart:{userId}`, chỉ `{productId, quantity}`, TTL 30 ngày. Không kiểm tồn kho khi thêm.
- **Checkout** `POST /cart/checkout` (bắt buộc `x-idempotency-key`): body chỉ có `items: [{productId}]`, `shippingAddress`, `voucherCode?`. Số lượng lấy từ giỏ, giá lấy từ Product. Các bước:
  1. Tính giá (thuế 10%, ship 30.000, voucher nếu có).
  2. Inventory giữ hàng 15 phút; đơn `PENDING_PAYMENT` cũ có món trùng bị thay thế.
  3. Promotion giữ lượt voucher.
  4. Transaction tạo đơn và outbox.
  5. Kiểm tra còn hàng (chốt #1), tạo payment intent, trả `payment_url`.
  - Giỏ không bị xoá lúc checkout. Chỉ trừ đúng món đã đặt khi thanh toán thành công.
- **State machine**: `PENDING_PAYMENT → PAID → FULFILLING → SHIPPED → DELIVERED → COMPLETED`, nhánh huỷ `CANCELLED`, nhánh hoàn `REFUNDING → REFUNDED`. Mọi đổi trạng thái qua `OrderTransitionService` (`UPDATE ... WHERE version` cùng outbox).
- **Huỷ và hoàn**: huỷ được khi chưa ship (hoàn `total − phí ship` nếu đã thanh toán). Hoàn hàng trong 7 ngày sau `DELIVERED`.
- **Scheduler**: hết hạn đơn chưa thanh toán (30 giây một lần), tự `COMPLETED` (10 phút một lần).

### 3.5 Thanh toán (`apps/payment`)
- Tạo payment intent idempotent theo `orderId`. Intent có `checkoutUrl` trỏ về `/simulator/pay/:intentId`.
- Webhook HMAC-SHA256 (`PAYMENT_WEBHOOK_SECRET`, bắt buộc), dedup theo `eventId`, outbox `PaymentSucceeded` hoặc `PaymentFailed`.
- Hoàn tiền: mỗi đơn hoàn tối đa một lần (`payment_refunds.orderId` unique).
- Simulator: `PAYMENT_SIM_MODE = manual | auto-success | auto-fail`. Tắt khi `NODE_ENV=production`. Không có cổng thanh toán thật.

### 3.6 Vận chuyển (`apps/shipping`)
- Carrier mô phỏng tạo mã vận đơn khi có `CreateShipment`. Giao hàng bằng timer (`SHIPPING_SIM_DELIVER_DELAY_MS`), endpoint admin `POST /shipments/:orderId/deliver`, hoặc webhook HMAC (`SHIPPING_WEBHOOK_SECRET`, bắt buộc).
- Carrier lỗi 3 lần → DLQ → `ShipmentFailed` → Orders huỷ đơn và hoàn tiền.

### 3.7 Thông báo (`apps/notification`)
- Consumer Kafka topic `order-events`, group `notification-service`, có Inbox khử trùng theo `eventId`.
- Xử lý `OrderCreated` và `OrderStatusChanged`: lấy email từ User (TCP), gửi qua `EmailProvider` (đang là simulated, chỉ log), ghi `sent_notifications`.
- `OrderPaid`, `OrderCancelled` và type khác: chỉ đánh dấu inbox, không gửi.
- Push (`PushProvider`) đã đăng ký nhưng chưa có handler gọi.

### 3.8 Đánh giá (`apps/review`)
- Tạo review kèm kiểm tra đã mua: gọi `Orders.GET_ORDER` (TCP) rồi kiểm tra chủ đơn, trạng thái (`PAID`…`COMPLETED`), và có chứa product. Unique `(userId, productId, orderId)`.
- Không tổng hợp rating lên Product. Không phân trang.

### 3.9 Khuyến mãi (`apps/promotion`)
- Voucher: code unique, `PERCENTAGE` hoặc `FIXED`, `minOrderValue`, hạn, `usageLimit`.
- Checkout: `VALIDATE_VOUCHER` (chỉ tính), `RESERVE_VOUCHER` (giữ lượt, khoá pessimistic), `RELEASE_VOUCHER` (trả lượt).
- Consumer `order-events`: `OrderPaid` → xác nhận lượt; `OrderCancelled{paid:false}` → trả lượt. Đơn đã thanh toán bị huỷ thì **không** trả lượt.
- `POST /vouchers/apply` (cũ) vẫn tiêu lượt ngay và không gắn đơn. Đây là gap cần quyết định (giữ hay xoá).

### 3.10 Media (`libs/media`)
- MinIO (S3-compatible), bucket `ecommerce-media` tự tạo. Dùng cho ảnh product và avatar. DB chỉ lưu object path. Presigned URL mặc định 1 giờ.
- Chưa có kiểm tra loại và dung lượng file.

---

## 4. Người dùng và stakeholder

| Nhóm | Vai trò | Nhu cầu chính |
|---|---|---|
| Khách hàng | Mua hàng | Duyệt catalog, giỏ hàng, checkout, thanh toán, theo dõi đơn, huỷ, hoàn hàng, đánh giá |
| Admin / back-office | Quản trị | Quản lý sản phẩm, tồn kho, voucher, vận đơn (chưa có giao diện) |
| Developer / học viên | Phát triển, học tập | Hiểu kiến trúc, CQRS, Outbox/Inbox, orchestration, trade-off |

---

## 5. Mục tiêu và tiêu chí thành công

### Mục tiêu
1. **Học tập kiến trúc**: xây hệ thống microservices hoàn chỉnh để hiểu nguyên lý, trade-off, pattern.
2. **Độ tin cậy**: nhất quán qua Outbox/Inbox, idempotency, optimistic lock, bù trừ khi lỗi.
3. **Nền tảng mở rộng**: observability, cache và xử lý bất đồng bộ (cache chưa làm).

### Tiêu chí đã đạt
- Mọi service có health check và graceful shutdown (`enableShutdownHooks`).
- Migration checkout v2 chạy đúng trên DB test (up/down/up) và DB dev (dữ liệu cũ được remap).
- 33/33 int-spec pass trên Postgres + Kafka thật (10 suite).
- ~532 unit test (mock) pass trên 61 suite; `nest build` 10 app xanh.
- E2E trên stack thật: E-01…E-13 PASS (chi tiết trong [e2e-test-report.md](../plans/261015-1700-checkout-v2-event-driven/reports/e2e-test-report.md)).

### Tiêu chí còn mở
- E-14 (tắt Kafka 30 giây, kiểm outbox PENDING → PUBLISHED): chưa chạy.
- k6 load test sau cutover: script đã cập nhật, chưa có số đo chính thức.
- Lỗi F1 (consumer `fromBeginning: false` có thể bỏ message khi service down): đã tái hiện, chưa xử lý, xem [design-trade-offs.md §2.4](./design-trade-offs.md).
- Coverage ≥70%: chưa có báo cáo coverage toàn repo.

---

## 6. Ràng buộc và giả định

| Ràng buộc | Giải thích |
|---|---|
| Không AWS, không deploy công cộng | Chạy local bằng Docker Compose |
| Simulate trước | Payment, Shipping, Email, Push là simulator. Provider thật là việc sau, cần ký raw body |
| Không SMS OTP | Dùng email nếu cần OTP |
| TCP cho RPC, Kafka cho event/command | Đảo quyết định "không dùng broker" ngày 2026-10-15. RabbitMQ không dùng (dependency còn trong `package.json`, chưa gỡ) |
| Một database PostgreSQL | Các service dùng chung một DB và một bộ migration; không FK chéo service |
| Host TCP hardcode `localhost` | Chạy nhiều container cần đưa vào config |

---

## 7. Lộ trình và phase

- **Phase 0** (nền tảng): health check, graceful shutdown, migration, idempotency, tracing. Hoàn thành.
- **Phase 1** (domain lõi): User, Product, Cart, Orders, RBAC, sổ địa chỉ. Hoàn thành (Saga đồng bộ cũ đã được thay bằng checkout v2).
- **Phase 2** (hệ sinh thái): Payment, Notification, Review, Promotion, Media. Hoàn thành.
- **Checkout v2** (cutover 2026-10-15): Kafka, Inventory, Shipping, payment intent, voucher, huỷ/hoàn, scheduler. Code và kiểm chứng đã xong như mục 5, còn E-14 và k6.
- **Phase 3** (production hardening): observability (đã có dashboard Infrastructure), Swagger, security audit, provider thật, search, load test. Đang lên kế hoạch.

Chi tiết: [project-roadmap.md](./project-roadmap.md).

---

## 8. Việc tiếp theo

1. Quyết định xử lý F1 (message bị bỏ khi consumer down) và đối soát đơn kẹt `FULFILLING`.
2. Chạy E-14 và k6 sau cutover, rồi lưu số đo.
3. Đóng các gap ưu tiên cao: kiểm chủ sở hữu cho `GET /orders*`, addresses, `POST /user/logout`.
4. Cache catalog, gỡ `cmd.ts` và dependency RabbitMQ.
5. Provider thật (VNPay, MoMo) và email/push thật (Resend/Brevo, FCM).
