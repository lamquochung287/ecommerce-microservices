# Design Decisions & Trade-offs

**Ngày cập nhật**: 2026-10-15
**Phạm vi**: các quyết định kiến trúc/nghiệp vụ đang có trong code (sau cutover checkout v2), cái được – cái mất, khi nào cần đổi. Phần chưa chạy trên Postgres/Kafka thật được ghi rõ. Mọi nhận định "đã xác minh" đều đối chiếu code (đường dẫn trong ngoặc).

Xem luồng: [business-flows.md](./business-flows.md), [module-processing-flows.md](./module-processing-flows.md).

---

## 1. Kiến trúc & giao tiếp

### 1.1 TCP cho RPC đồng bộ + Kafka cho event/command (đảo quyết định "không dùng broker")
| Được | Mất |
|---|---|
| Event/command có durable queue, redelivery, replay, nhiều consumer cho cùng topic (Notification + Promotion cùng đọc `order-events`) mà producer không cần biết consumer | Thêm hạ tầng (Kafka KRaft 1 broker local, chưa có HA/replication), thêm vận hành (topic phải tạo trước vì tắt auto-create, DLQ không có công cụ replay) |
| At-least-once thật: outbox chỉ đánh dấu `PUBLISHED` sau khi broker ack; consumer idempotent bằng Inbox + trạng thái đơn | Eventual consistency: sau thanh toán đơn đi `PAID → FULFILLING → SHIPPED` qua nhiều bước bất đồng bộ; UI phải chấp nhận trạng thái trung gian |
| Latency RPC thấp cho đường cần trả lời ngay (reserve, validate, check) vẫn qua TCP | Hai transport trong cùng app hybrid: phải gắn `Transport.TCP`/`Transport.KAFKA` tường minh cho mọi handler (nếu không, `{"cmd":...}` bị coi là tên topic) |

**Giữ nguyên**: Gateway→service và service→service RPC là TCP point-to-point, coupling thời gian vẫn còn ở đường đồng bộ (Orders↔Inventory/Payment/Product/Promotion khi checkout, Review→Orders, Notification→User) và host vẫn hardcode `localhost`.
**Chưa kiểm chứng trên stack thật**: relay→broker→consumer đã có int-spec ở nền tảng (đã chạy), nhưng luồng nhiều service qua Kafka mới chỉ có unit test (mock) và build.

### 1.2 Gateway là entry duy nhất, auth tập trung qua User service
- **Được**: service nội bộ không phải tự xác thực; revoke tức thì (xoá key Redis); quyền luôn mới nhất.
- **Mất**: **mỗi request có auth tốn 1 TCP + 1 Redis + 1–2 query DB** ở User (`user.service.ts verifyToken`) → User thành SPOF và nút cổ chai; Gateway không cache kết quả verify.
- **Lựa chọn thay thế**: JWT tự chứa + cache `permissions` ngắn hạn (30–60s) tại Gateway; chấp nhận quyền cũ tối đa 60s.

### 1.3 CQRS ở service nghiệp vụ, không ở User/Notification
- **Được**: handler nhỏ, dễ test, ranh giới rõ read/write.
- **Mất**: nhiều file/boilerplate; **không phải CQRS đầy đủ** — read và write dùng **cùng 1 DB/model** (không read model riêng, không event sourcing). `EventBus` nội bộ gần như chưa được dùng (`ProductCreatedHandler` chỉ `console.log`; `OrderCreatedHandler` đã xoá cùng Saga cũ).
- Event/command giữa service đi bằng Outbox → Kafka, không đi qua `EventBus` của `@nestjs/cqrs`. Consumer Kafka là controller mỏng → `CommandBus`.

### 1.4 Một database PostgreSQL + một bộ migration dùng chung
- **Được**: dựng nhanh, migration đơn giản, join tiện khi cần báo cáo.
- **Mất**: **không phải database-per-service**: mọi service đều `migrationsRun:true` trên cùng thư mục migration → race khi nhiều service khởi động đồng thời; khó tách service/scale độc lập; một schema lỗi ảnh hưởng tất cả. Ranh giới giữ bằng **kỷ luật** (không FK chéo, tham chiếu bằng UUID) chứ không bằng cơ chế.
- **Hệ quả tích cực**: không có FK chéo nên tách DB về sau chỉ cần chuyển bảng.

### 1.5 Host TCP hardcode `localhost`
`main.ts` và các `ClientsModule.register` dùng `localhost` + `PORT_TCP`. Chạy trong Docker/K8s cần đưa host/port vào `ConfigService` (hiện đang vi phạm tinh thần quy tắc §4.4 CLAUDE.md cho phần transport).

---

## 2. Checkout v2, Orchestration, Outbox/Inbox

### 2.1 Orchestration bằng event + state machine lưu bền (thay cho Saga trong handler)
- **Được**: trạng thái luồng nằm ở `orders.status` (bền, có `version`), mỗi bước là một transaction (đổi state + Outbox cùng TX) nên crash không để lại "nửa chừng" vô danh: event chưa phát vẫn nằm trong outbox, consumer retry/đọc lại đơn. Không còn cửa sổ "đã trừ kho nhưng chưa có đơn" ở bước trừ thật (reserve có TTL, job Inventory tự thu hồi).
- **Mất**: luồng phân tán qua nhiều service, khó theo dõi một đơn từ đầu tới cuối (cần trace theo `orderId`); độ phức tạp của race (huỷ vs shipment, thanh toán muộn); không có saga engine/dashboard, DLQ chỉ là topic.
- **Rủi ro còn lại (đã chấp nhận, ghi trong code/CLAUDE.md)**:
  1. Crash giữa `Promotion.RESERVE_VOUCHER` và TX tạo đơn → lượt voucher bị giữ vĩnh viễn (redemption `RESERVED` mồ côi, không có event huỷ).
  2. `Inventory.RESERVE` trả luôn phần giữ của đơn `replaces`; nếu sau đó voucher/TX lỗi, đơn cũ còn `PENDING_PAYMENT` nhưng mất reservation → chốt #2 hoặc scheduler huỷ khi tới (người dùng có thể thấy link thanh toán chết).
  3. Reserve xong nhưng TX tạo đơn lỗi và `Inventory.RELEASE` cũng lỗi → kho giữ tới hết TTL (15') rồi job Inventory thu hồi.
  4. Timer simulator (Payment auto, Shipping giao hàng) nằm trong bộ nhớ process, mất khi restart (chỉ dev).
  5. Hoàn tiền `FAILED` không retry được (unique `orderId`); hoàn hàng gặp `PaymentRefundFailed` → đơn kẹt `REFUNDING`, chỉ có log error (admin xử lý tay).
  6. Thanh toán muộn vào đơn đã huỷ → hoàn **toàn bộ** số đã thu (mặc định đã chọn, chưa có xác nhận riêng của người dùng).

### 2.2 Reserve → commit/release thay cho trừ kho ngay
- **Được**: đơn bỏ dở không làm mất kho (TTL 15', `replaces` giải phóng đơn cũ trong cùng transaction); `reserve` atomic toàn bộ món; khoá theo thứ tự id (`ORDER BY id FOR UPDATE`) nên không deadlock; CHECK `reserved >= 0 AND onHand >= reserved` là lớp chặn cuối cùng ở DB.
- **Mất**: thêm dịch vụ (Inventory) + một lần gọi TCP đồng bộ trong checkout; thêm bảng `reservations` và job hết hạn; `Product` không còn biết tồn kho (catalog phải ghép qua Gateway, Inventory chậm → `UNKNOWN`).
- Sản phẩm tạo mới chưa có `stock_items` cho tới khi `ADJUST_STOCK` lần đầu (available = 0).
- **Chưa kiểm chứng trên Postgres thật**: SQL `unnest` với mảng chứa NULL, `FOR UPDATE OF s` + JOIN, `ON CONFLICT` với unique NULLS NOT DISTINCT.

### 2.3 Khoá lạc quan trên Order (`UPDATE ... WHERE version`)
- **Được**: bên thua race (huỷ vs `ShipmentCreated`, `PaymentSucceeded` vs scheduler) luôn biết để đọc lại state; không giữ lock DB lâu; user nhận 409 rõ ràng, consumer retry tự nhiên.
- **Mất**: mỗi consumer phải đọc lại đơn + kiểm lại `canTransition` (dễ quên khi thêm handler mới); 409 cho user khi đua; không dùng `save()` của TypeORM vì `@VersionColumn` không tự chặn ghi đè.
- Nhiều instance Orders chạy scheduler: vẫn đúng nhờ lock, chỉ tốn công trùng.

### 2.4 Transactional Outbox + Inbox qua Kafka (at-least-once)
- **Được**: không "ghi DB xong mà quên phát"; không mất event khi consumer/broker down (outbox giữ `PENDING`, relay gửi lại); `FOR UPDATE SKIP LOCKED` cho nhiều instance; Inbox khử trùng theo `(consumer, eventId)`; retry 3 → DLQ → event thất bại tương ứng (`ShipmentFailed`, `PaymentRefundFailed`).
- **Mất / giới hạn**:
  - At-least-once chứ không exactly-once: consumer phải idempotent (đã làm bằng Inbox + trạng thái); side effect ngoài DB (email) có thể trùng khi commit lỗi sau khi gửi.
  - Relay poll theo `OUTBOX_RELAY_INTERVAL_MS` → latency vài trăm ms–giây; thứ tự chỉ đảm bảo theo key `orderId` (partition).
  - `FAILED` sau `OUTBOX_MAX_RETRY` chỉ có metric `outbox_failed_total`, chưa có alert rule/replay tool; DLQ chưa có công cụ replay.
  - Consumer `fromBeginning:false`: message phát trước khi group join lần đầu bị bỏ → phải khởi động consumer trước producer.
  - Producer kết nối lười (Kafka tắt lúc boot không làm sập relay) nhưng `ensureKafkaTopics` làm consumer exit 1 nếu broker tắt lúc khởi động.

### 2.5 Payment bất đồng bộ qua intent + webhook
Payment không còn charge trong request: `createIntent` (idempotent theo `orderId`) trả `checkoutUrl`; webhook (HMAC, `timingSafeEqual`, khử trùng `eventId`) → outbox `PaymentSucceeded/Failed`. Mất: user phải qua bước thanh toán riêng; cần chốt #1/#2/#3 để không thanh toán khi hết hàng; tiền có thể về sau khi đơn đã huỷ (hoàn tự động). Được: không còn "charge OK nhưng timeout ⇒ đơn bị huỷ" của Saga cũ. Payment/Shipping là **simulator** (không cổng ngoài); provider thật cần ký raw body thay vì `JSON.stringify`.

### 2.6 Cart ở Redis, chỉ lưu `productId + quantity`
- **Được**: nhanh, TTL tự dọn, giá luôn lấy mới lúc checkout; checkout chọn một phần giỏ, cart giữ nguyên tới khi trả tiền (chỉ trừ đúng món đã đặt).
- **Mất**: mất giỏ nếu Redis không persist; không kiểm tra tồn tại/tồn kho khi thêm; không có giá/ảnh để hiển thị; read-modify-write không atomic; chưa hỗ trợ variant (`variantId` ở checkout → 400, trong khi kho có cột `variantId`).

### 2.7 Định giá ở Orders (thay cho Gateway)
Orders lấy số lượng từ cart và giá từ Product (`OrderPricingService`), Gateway chỉ chuyển tiếp `{userId từ token, dto}`; `unitPrice`/`quantity`/`userId` từ client bị loại ở biên (Gateway `forbidNonWhitelisted` → 400; Orders `whitelist`). Route `POST /orders` tin dữ liệu client đã **xoá**. Đánh đổi: Orders phụ thuộc đồng bộ vào Product/Inventory/Payment/Promotion khi checkout (timeout 10s, không có breaker ở hướng service→service).

### 2.8 Idempotency checkout ở Gateway
Key scope theo `userId + method + path`, marker `processing` 120s, kết quả 24h, replay đúng status gốc; Redis lỗi → 503 (fail-closed) cho route bắt buộc. Còn hở: get-rồi-set không nguyên tử (thiếu `SET NX` trong `CachedService`); lớp chống trùng cuối cùng là `replaces` ở Orders và idempotency của Payment/Inventory theo `orderId`.

---

## 3. Dữ liệu & tham chiếu giữa service

### 3.1 Tham chiếu mềm bằng UUID (không FK chéo service)
Order lưu `userId`, `productId` như UUID thường. **Được**: tách service dễ, không khoá chéo. **Mất**: không có toàn vẹn tham chiếu (xoá product vẫn còn order trỏ tới — `DeleteProduct` hard delete); dữ liệu hiển thị phải ghép qua nhiều call.

### 3.2 Snapshot (denormalize) giá & địa chỉ trong order
**Được**: đơn lịch sử bất biến, không phụ thuộc Address Book/giá hiện tại. **Mất**: lặp dữ liệu; không lưu tên sản phẩm/SKU trong `order_items` (hiển thị đơn cũ vẫn phải gọi Product, và product đã xoá thì mất tên).

### 3.3 `userId` (uuid) vs `id` (serial) trong User
Hai định danh cùng tồn tại: `id` cho quan hệ nội bộ, `userId` cho phần còn lại. **Mất**: dễ nhầm lẫn (`findIdByUserId` từng tồn tại, nay bị comment). Nên thống nhất một khoá công khai.

### 3.4 Soft delete không nhất quán
Entity có `deletedAt` nhưng `DeleteProduct` dùng `remove` (hard), `DeleteVariant` dùng `softRemove`, Brand/Attribute/Role hard delete. Cần quyết định chính sách (đặc biệt Product vì order tham chiếu).

### 3.5 Tiền dùng `decimal(10,2)` và `number` trong code
`decimal` map sang `string` ở TypeORM; code ép `Number(...)` khi cộng. **Rủi ro**: sai số float khi nhân/cộng (tuy đã `Math.round(x*100)/100` ở một số chỗ), trần 10 chữ số (tối đa ~99.999.999,99 — **có thể quá nhỏ cho VND** nếu đơn lớn). Cân nhắc lưu số nguyên (đơn vị nhỏ nhất) hoặc dùng thư viện decimal.

---

## 4. Bảo mật & xác thực

| Quyết định | Được | Mất / lưu ý |
|---|---|---|
| Quyền = bitmask 1 số nguyên | Kiểm tra O(1), lưu gọn, gộp role bằng OR | Khó đọc/audit; chỉ 4 action cố định; giới hạn 2^53 khi ép `Number` (còn rộng); không có phân quyền theo tài nguyên (ownership) |
| Quyền tính lại mỗi request | Thu hồi tức thì | Chi phí DB mỗi request (§1.2) |
| Session = refresh token trong Redis (key `refresh_token:{user}:{session}`) | Revoke từng session | **Redis chết/flush = mọi user bị đăng xuất**; chưa có endpoint refresh nên access 15 phút hết là phải login lại |
| API key (`x-api-key`) cho mọi route (kể cả webhook; miễn `/health`, `/simulator/*`) | Chặn truy cập ẩu | Là secret dùng chung, không định danh client; webhook của provider thật phải được cấp key này hoặc đổi cách xác thực |
| Webhook (payment, shipping) xác thực bằng HMAC | Đúng chuẩn; `PAYMENT_WEBHOOK_SECRET`/`SHIPPING_WEBHOOK_SECRET` bắt buộc (không fallback), so sánh `timingSafeEqual` | `JSON.stringify(payload)` phụ thuộc thứ tự key → provider thật thường ký trên **raw body** (cần đổi khi tích hợp thật); webhook vẫn cần `x-api-key` (provider thật phải được cấp key); simulator đi đúng đường này nên không bỏ qua chữ ký |
| Throttle Redis theo IP | Chống brute-force login (5/phút) | IP sau proxy/NAT có thể gộp nhiều user; cần cấu hình `trust proxy` |

---

## 5. Rủi ro & gap đã xác minh trong code

Mức độ: **CAO** = ảnh hưởng tiền/dữ liệu/bảo mật; **TB**; **THẤP**.

| # | Rủi ro | Mức | Bằng chứng | Gợi ý |
|---|---|---|---|---|
| ~~R1~~ | **Đã đóng**: `POST /orders` tin `userId` + `unitPrice` từ client | — | Route + `CreateOrderHandler` đã xoá; checkout lấy giá/số lượng server-side | — |
| R2 | `GET /orders`, `GET /orders/:id`, `GET /orders/:id/refunds` **không kiểm tra chủ sở hữu**; `GET /orders` không `userId` trả mọi đơn (`/orders/:id/pay\|cancel\|return` đã kiểm tra) | CAO | `gateway/orders/orders.controller.ts` + `GetOrdersHandler` | Ép `userId = req.user.userId` cho customer; tách route admin |
| R3 | Address `PUT/DELETE/POST :id/default` không kiểm tra chủ sở hữu (IDOR) | CAO | `gateway/user/address.controller.ts`, `address.service.ts` | Truyền `userId` từ JWT và filter theo user |
| R4 | `POST /user/logout` không auth, tin `userId/sessionId` trong body → ai biết cặp này có thể đăng xuất người khác | TB | `user.controller.ts` (gateway) | Dùng `req.user` từ JWT |
| ~~R5~~ | **Đã đóng**: `PATCH /orders/:id/status` đổi tay bỏ qua outbox, cancel không hoàn kho/tiền | — | Route/handler đã xoá; mọi chuyển trạng thái qua `OrderTransitionService`; huỷ có release/restock/refund | — |
| ~~R6~~ | **Đã đóng**: refund chỉ cập nhật sổ sách, check-then-insert không lock | — | `POST /refunds`, approve/reject đã xoá; hoàn tiền thật qua Payment (`RefundPayment`, unique `orderId`) | — |
| R7 | `/vouchers/apply` (giữ nguyên) vẫn tiêu lượt không gắn đơn và không hoàn; checkout dùng luồng reserve riêng | THẤP | `apply-voucher.handler.ts` | Xoá/khoá route nếu không còn dùng |
| R8 | Idempotency Gateway: get-rồi-set không nguyên tử (hai request đồng thời cùng key có thể cùng lọt) | TB | `idempotency.interceptor.ts` + `CachedService` không có `SET NX` | Thêm `SET NX PX` vào `libs/cached`; Orders vẫn chống trùng nhờ `replaces` |
| R9 | `GET /user/profile/:userId` ở Gateway là stub trả `undefined` | THẤP | `gateway/user/user.service.ts getProfile` | Triển khai (gọi `GET_USER_INFO` với `req.user.userId`) |
| R10 | Upload không giới hạn kích thước/loại file; ảnh product ghi qua 2 bước không transaction | TB | `user.controller.ts`, `product.controller.ts` (gateway) | `ParseFilePipe` (maxSize, mimetype); ghi path lại bằng thao tác atomic |
| R11 | DLQ/outbox `FAILED` chưa có alert/replay; Notification list không có route Gateway | THẤP | `libs/messaging`, `notification.controller.ts` | Alert rule trên `outbox_failed_total`, công cụ replay DLQ |
| R12 | Gateway `/health` không gồm payment/notification/review/promotion/inventory/shipping và Kafka | THẤP | `gateway/health/health.controller.ts` | Thêm `checkTcpService` + kiểm tra broker |
| R13 | `POST /user/register` tạo user `permissions=0`, không tự gán role Customer → user mới không dùng được API cần quyền | TB | `user.service.ts register` | Tự gán role mặc định khi đăng ký |
| R14 | Tiền `decimal(10,2)` có thể không đủ cho VND | THẤP | `order.entity.ts` | Nới `precision` hoặc dùng integer |
| R15 | Provider thanh toán/vận chuyển bind cứng Simulated (`useFactory` chỉ tạo Simulated), không chọn theo env | THẤP | `payment.module.ts`, `shipping.module.ts` | Chọn provider theo `ConfigService` khi tích hợp thật |
| R16 | Crash giữa `RESERVE_VOUCHER` và TX tạo đơn làm kẹt lượt voucher; `Inventory.RESERVE` trả phần đơn `replaces` trước khi biết TX có thành công | TB | `checkout.handler.ts` (§2.1) | Job quét redemption `RESERVED` mồ côi; khôi phục reservation của đơn cũ khi TX lỗi |
| R17 | Timer simulator (Payment auto, Shipping giao hàng) mất khi restart | THẤP | `payment-auto-simulator.service.ts`, `delivery-timer.service.ts` | Chỉ cho dev; tắt khi `NODE_ENV=production` |
| R18 | Hoàn tiền `FAILED` không retry được; hoàn hàng gặp `PaymentRefundFailed` kẹt `REFUNDING` | TB | `refund-payment.handler.ts`, `handle-payment-event.handler.ts` | Endpoint admin retry/xử lý tay |
| R19 | Đơn `PROCESSING` cũ (đã thu tiền) bị migration chuyển `PENDING_PAYMENT` và huỷ **không hoàn tiền** khi cutover | TB (nếu có dữ liệu thật) | `FinalizeOrderStatusAndStockOwnership` | Chỉ chấp nhận cho dữ liệu seed; với dữ liệu thật cần phương án riêng |

> Các mục R1–R3 nên xử lý **trước** khi mở ra ngoài môi trường dev (đều liên quan phân quyền theo chủ sở hữu, hiện hoàn toàn chỉ có phân quyền theo module/action).

---

## 6. Hiệu năng & vận hành

| Điểm | Hiện trạng | Hệ quả / hướng |
|---|---|---|
| Product catalog | Không cache (Redis có sẵn); Gateway gọi Inventory thêm 1 lần/trang | `getProducts` ILIKE `%q%` không dùng index → chậm với 50.000 sản phẩm seed; cần trigram index hoặc search engine |
| `GetOrders` | Không phân trang | Trả toàn bộ đơn; cần `PaginationQueryDto` (đã có ở libs/common) |
| `getReviewsByProduct` | Không phân trang, không tổng hợp rating | Cần aggregate + cache |
| Auth per request | 1 TCP + Redis + DB | Cache ngắn hạn tại Gateway (§1.2) |
| Outbox relay | Poll theo interval, `SKIP LOCKED`, index `(status, source, seq)` | Latency vài trăm ms–giây; NOTIFY/LISTEN nếu cần thấp hơn |
| Load test | k6 `checkout` đã đổi sang body checkout v2 (`x-idempotency-key`); chưa chạy lại sau cutover | Cần stack có Kafka + `PAYMENT_SIM_MODE=auto-success`; đơn k6 không thanh toán sẽ hết hạn sau 15' và trả kho |
| Observability | Tracing + Prometheus + Grafana đã nối; counter `outbox_failed_total{source}` | Chưa có alert rule (outbox FAILED, DLQ, consumer lag, breaker open); dashboard Infrastructure mới chỉ để xem, chưa kiểm chứng trên stack thật |
| Test | Unit test (mock) đã phủ phần lớn handler mới; int-spec (`npm run test:int`) viết sẵn cho race/lock/SKIP LOCKED | **Chưa chạy** int-spec và e2e trên stack thật tại thời điểm cutover; 2 spec cũ của User (`role.service`, `address.service`) vẫn cần Postgres; `gateway.controller.spec.ts` boilerplate đang fail |
| Scale ngang | Outbox `SKIP LOCKED`, scheduler an toàn nhờ optimistic lock, host `localhost` | Cần cấu hình host/broker khi tách container |

---

## 7. Quyết định đã chốt vs cần chốt

**Đã chốt (code phản ánh)**: TCP cho RPC đồng bộ + Kafka cho event/command (at-least-once + Inbox, retry 3 → DLQ); Gateway entry duy nhất; CQRS cho service nghiệp vụ; Orders là orchestrator với state machine + khoá lạc quan; reserve → commit/release kho (Inventory riêng); payment bất đồng bộ qua intent + webhook HMAC; Shipping riêng với carrier mô phỏng; voucher giữ lượt lúc checkout, trả khi đơn chưa thanh toán bị huỷ; huỷ khi chưa ship và hoàn hàng trong 7 ngày (chỉ cả đơn, hoàn `total − phí ship`); cutover một lần (không feature flag); session qua Redis; RBAC bitmask; provider (payment/shipping/email/push) trừu tượng hoá qua DI, mặc định Simulated.

**Cần chốt (ảnh hưởng thiết kế)**
1. Hoàn tiền thanh toán muộn (đơn đã `CANCELLED`): hiện hoàn toàn bộ số đã thu — xác nhận có trừ phí ship không.
2. Đơn cũ đang dở khi cutover trên dữ liệu thật (hiện chỉ seed/dev): `PROCESSING → PENDING_PAYMENT` + huỷ không hoàn tiền có chấp nhận không, hay map `PROCESSING → PAID` + tạo reservation `COMMITTED`.
3. `/vouchers/apply` cũ: giữ hay xoá.
4. Hỗ trợ `variantId` trong cart/checkout (hiện 400).
5. Ownership/ABAC: bổ sung kiểm tra chủ sở hữu cho `GET /orders*`, addresses ở Gateway hay trong từng service?
6. Endpoint refresh token / role mặc định khi register?
7. Chạy nhiều instance/container: cấu hình host/broker, HA Kafka, công cụ replay DLQ.

---

## 8. Tài liệu liên quan
- [business-flows.md](./business-flows.md) · [module-processing-flows.md](./module-processing-flows.md)
- [system-architecture.md](./system-architecture.md) · [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) · [target-checkout-architecture.md](./target-checkout-architecture.md)
- [project-roadmap.md](./project-roadmap.md)
