# Design Decisions & Trade-offs

**Ngày cập nhật**: 2026-10-05
**Phạm vi**: các quyết định kiến trúc/nghiệp vụ đang có trong code, cái được – cái mất, khi nào cần đổi. Mọi nhận định "đã xác minh" đều đối chiếu code (đường dẫn trong ngoặc).

Xem luồng: [business-flows.md](./business-flows.md), [module-processing-flows.md](./module-processing-flows.md).

---

## 1. Kiến trúc & giao tiếp

### 1.1 TCP point-to-point thay cho message broker
| Được | Mất |
|---|---|
| Hạ tầng tối giản (không RabbitMQ/Kafka), dev local dễ chạy, request-response đồng bộ sẵn có | Không có broadcast: producer phải biết từng consumer (`OutboxWorker.subscribers`) — thêm consumer = sửa producer |
| Latency thấp, debug đơn giản bằng trace | Không có durable queue/ack/redelivery: event `emit` là fire-and-forget; consumer down = mất event |
| | Coupling thời gian: Orders↔Product↔Payment, Review→Orders, Notification→User phải cùng sống |

**Khi nào đổi**: khi cần ≥3 consumer cho cùng event, cần replay, hoặc cần chịu được consumer down → quay lại broker (Kafka/RabbitMQ/NATS JetStream); Outbox hiện có đã là điểm cắm sẵn.

### 1.2 Gateway là entry duy nhất, auth tập trung qua User service
- **Được**: service nội bộ không phải tự xác thực; revoke tức thì (xoá key Redis); quyền luôn mới nhất.
- **Mất**: **mỗi request có auth tốn 1 TCP + 1 Redis + 1–2 query DB** ở User (`user.service.ts verifyToken`) → User thành SPOF và nút cổ chai; Gateway không cache kết quả verify.
- **Lựa chọn thay thế**: JWT tự chứa + cache `permissions` ngắn hạn (30–60s) tại Gateway; chấp nhận quyền cũ tối đa 60s.

### 1.3 CQRS ở service nghiệp vụ, không ở User/Notification
- **Được**: handler nhỏ, dễ test, ranh giới rõ read/write.
- **Mất**: nhiều file/boilerplate; **không phải CQRS đầy đủ** — read và write dùng **cùng 1 DB/model** (không read model riêng, không event sourcing). `EventBus` nội bộ gần như chưa được dùng (`ProductCreatedHandler`, `OrderCreatedHandler` chỉ `console.log`).
- Event "thật" giữa service đi bằng `ClientProxy.emit` + Outbox, không đi qua `EventBus` của `@nestjs/cqrs`.

### 1.4 Một database PostgreSQL + một bộ migration dùng chung
- **Được**: dựng nhanh, migration đơn giản, join tiện khi cần báo cáo.
- **Mất**: **không phải database-per-service**: mọi service đều `migrationsRun:true` trên cùng thư mục migration → race khi nhiều service khởi động đồng thời; khó tách service/scale độc lập; một schema lỗi ảnh hưởng tất cả. Ranh giới giữ bằng **kỷ luật** (không FK chéo, tham chiếu bằng UUID) chứ không bằng cơ chế.
- **Hệ quả tích cực**: không có FK chéo nên tách DB về sau chỉ cần chuyển bảng.

### 1.5 Host TCP hardcode `localhost`
`main.ts` và các `ClientsModule.register` dùng `localhost` + `PORT_TCP`. Chạy trong Docker/K8s cần đưa host/port vào `ConfigService` (hiện đang vi phạm tinh thần quy tắc §4.4 CLAUDE.md cho phần transport).

---

## 2. Checkout, Saga, Outbox

### 2.1 Saga orchestration "trong handler" (không có saga engine/state lưu bền)
- **Được**: dễ đọc (một hàm 3 bước), không cần hạ tầng workflow.
- **Mất**: trạng thái saga **chỉ nằm trong bộ nhớ process** + `order.status`. Crash giữa các bước ⇒ không ai biết cần compensate. Các cửa sổ lỗi còn tồn tại (đã xác minh trong `create-order.handler.ts`):
  1. Crash sau S1 (đã trừ kho) trước S2 (chưa có order) → kho mất, **không dấu vết**.
  2. Crash sau S2 → order kẹt `PENDING`, kho đã trừ; không có job dọn.
  3. Payment đã trừ tiền nhưng phản hồi timeout → Orders huỷ đơn + hoàn kho, **tiền đã đi**; chỉ giảm nhẹ nhờ idempotency key khi retry.
  4. `release()` hoàn kho best-effort (lỗi chỉ log).
- **Đã cải thiện so với bản trước**: timeout/exception khi gọi Payment nay được bắt và compensate (`tcp-payment.provider.ts` trả `success:false`), không còn kẹt `PENDING` do lỗi này.
- **Hướng sửa (theo chi phí tăng dần)**: (a) job quét đơn `PENDING` quá N phút → reconcile với Payment/Product; (b) ghi Outbox `order.reserve_requested` **trước** khi trừ kho để có dấu vết; (c) saga bền (state table / Temporal).

### 2.2 Trừ kho ngay ("reserve" = trừ thật) thay vì giữ chỗ
- **Được**: đơn giản, chống oversell chắc chắn (kho không bao giờ âm — check `next < 0` + optimistic lock).
- **Mất**: đơn `PENDING/PROCESSING` bị bỏ dở **chiếm kho vô thời hạn** (không TTL); không phân biệt "đã giữ" và "đã bán"; cancel thủ công không hoàn kho.
- **Thay thế**: cột `reservedStock` + TTL/giải phóng tự động; hoặc hoàn kho tự động khi `→ CANCELLED`.

### 2.3 Optimistic locking cho kho (`@VersionColumn`) + retry 1 lần
- **Được**: không giữ lock DB lâu; hợp khi tranh chấp thấp.
- **Mất**: sản phẩm "hot" (flash sale) → tranh chấp cao → nhiều 409 sau 1 retry. Mỗi `save()` Product (kể cả sửa mô tả) cũng bump `version` → có thể làm hỏng một lần trừ kho đang chạy.
- **Thay thế khi tải cao**: `UPDATE products SET stock = stock - :q WHERE id=:id AND stock >= :q` (1 câu atomic, không cần version), hoặc Redis `DECRBY` + đồng bộ DB.
- Reserve nhiều item chạy **tuần tự** → latency tuyến tính theo số dòng; nhưng tránh được deadlock thứ tự lock.

### 2.4 Transactional Outbox + polling mỗi giây
- **Được**: event được ghi cùng transaction với thay đổi order (không "ghi DB xong mà quên phát").
- **Mất / giới hạn thật của implementation**:
  - Phát bằng TCP `emit` (không có ack) → đánh dấu `PUBLISHED` ngay dù consumer down ⇒ **at-most-once**, không phải at-least-once như Outbox chuẩn.
  - Polling 1s → latency ≥ 0–1s và tải DB đều đặn; nhiều instance Orders sẽ **phát trùng** (không `SKIP LOCKED`).
  - Fan-out thủ công; một trong các subscriber trỏ **về chính Orders** (không có handler) — dead target.
  - `FAILED` sau 5 lần: không alert, không replay.
  - Consumer (Notification) **không idempotent theo event id** (payload cũng không có eventId) → trùng ⇒ email trùng.
- **Hướng sửa**: thêm `eventId` vào payload + khử trùng ở consumer; ack thực (request-response `send`) hoặc broker; `FOR UPDATE SKIP LOCKED`; bỏ subscriber thừa.

### 2.5 Orders không phản ứng với `payment_succeeded/failed`
Payment emit sự kiện cho Orders nhưng Orders không có `@EventPattern` → `PROCESSING→PAID` chỉ xảy ra khi admin PATCH. Thực tế luồng hiện là **đồng bộ** (capture trong checkout), nên event là dư; nhưng khi chuyển sang provider thật dùng webhook bất đồng bộ (VNPay/MoMo) thì **bắt buộc** nối webhook → cập nhật Order, nếu không đơn sẽ kẹt `PROCESSING`.

### 2.6 Cart ở Redis, chỉ lưu `productId + quantity`
- **Được**: nhanh, TTL tự dọn, giá luôn lấy mới lúc checkout (không bị giá cũ).
- **Mất**: mất giỏ nếu Redis không persist; không kiểm tra tồn tại/tồn kho khi thêm; không có giá/ảnh để hiển thị (client phải gọi Product thêm); read-modify-write không atomic; không hỗ trợ variant (cart theo `productId`, trong khi kho có cả `variantId`).

### 2.7 Checkout lấy giá ở Gateway, không ở Orders
- **Được**: `/cart/checkout` chống tamper giá.
- **Mất**: **logic định giá nằm ở Gateway** (trái nguyên tắc "Gateway không chứa nghiệp vụ") và Orders vẫn tin `unitPrice` đầu vào → `POST /orders` trực tiếp bypass được (xem §5-R1). Nên chuyển việc lấy giá vào Orders (gọi Product) hoặc bỏ `POST /orders` public.

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
| API key (`x-api-key`) cho **mọi** route (kể cả webhook) | Chặn truy cập ẩu | Là secret dùng chung, không định danh client; webhook của provider thật phải được cấp key này hoặc đổi cách xác thực |
| Webhook xác thực bằng HMAC | Đúng chuẩn | Secret fallback `'simulated-webhook-secret'` nếu thiếu env; `JSON.stringify(payload)` phụ thuộc thứ tự key → provider thật thường ký trên **raw body** (cần đổi khi tích hợp thật); so sánh chuỗi không constant-time |
| Throttle Redis theo IP | Chống brute-force login (5/phút) | IP sau proxy/NAT có thể gộp nhiều user; cần cấu hình `trust proxy` |

---

## 5. Rủi ro & gap đã xác minh trong code

Mức độ: **CAO** = ảnh hưởng tiền/dữ liệu/bảo mật; **TB**; **THẤP**.

| # | Rủi ro | Mức | Bằng chứng | Gợi ý |
|---|---|---|---|---|
| R1 | `POST /orders` nhận `userId` + `unitPrice` từ client; customer có `ORDER\|CREATE` có thể đặt đơn **giá 0 / mạo danh user khác** | CAO | `gateway/orders/orders.controller.ts`, `orders/dto/order.dto.ts`, seed role Customer | Orders tự lấy giá từ Product, lấy `userId` từ JWT; hoặc khoá endpoint cho admin |
| R2 | `GET /orders`, `GET /orders/:id`, `GET /orders/:id/refunds`, `POST /refunds` **không kiểm tra chủ sở hữu**; `GET /orders` không `userId` trả mọi đơn | CAO | `OrdersController` (gateway) + `GetOrdersHandler` | Ép `userId = req.user.userId` cho customer; tách route admin |
| R3 | Address `PUT/DELETE/POST :id/default` không kiểm tra chủ sở hữu (IDOR) | CAO | `gateway/user/address.controller.ts`, `address.service.ts` | Truyền `userId` từ JWT và filter theo user |
| R4 | `POST /user/logout` không auth, tin `userId/sessionId` trong body → ai biết cặp này có thể đăng xuất người khác | TB | `user.controller.ts` (gateway) | Dùng `req.user` từ JWT |
| R5 | `PATCH /orders/:id/status` cho phép PAID/SHIPPED/DELIVERED chỉ cần `ORDER\|UPDATE`; cancel không hoàn kho/tiền | TB | `update-order-status.handler.ts` | Gắn side-effect vào transition (hoàn kho khi CANCELLED); tự động PAID từ Payment |
| R6 | Refund chỉ cập nhật sổ sách; check-then-insert không lock (có thể vượt tổng tiền khi 2 request song song) | TB | `create/approve-refund.handler.ts` | Lock order row (`FOR UPDATE`) khi tạo/duyệt; gọi provider hoàn tiền |
| R7 | Voucher chưa nối checkout; lượt dùng bị trừ ngay khi `apply`, không hoàn; 1 user apply nhiều lần | TB | `apply-voucher.handler.ts` | Tích hợp vào CreateOrder (trong saga), lưu `voucherCode/discount` vào order, bảng redemption theo user |
| R8 | `IdempotencyInterceptor`: key không scope theo user/route; trả 200 thay vì status gốc; fail-open khi Redis lỗi | TB | `idempotency.interceptor.ts` | Prefix key bằng `userId + method + path`; lưu cả status code |
| R9 | `GET /user/profile/:userId` ở Gateway là stub trả `undefined` | THẤP | `gateway/user/user.service.ts getProfile` | Triển khai (gọi `GET_USER_INFO` với `req.user.userId`) |
| R10 | Upload không giới hạn kích thước/loại file; ảnh product ghi qua 2 bước không transaction | TB | `user.controller.ts`, `product.controller.ts` (gateway) | `ParseFilePipe` (maxSize, mimetype); ghi path lại bằng thao tác atomic |
| R11 | Hết hạn Outbox `FAILED`, Notification trùng event, Notification list không có route Gateway | THẤP | `outbox.worker.ts`, `order-events.controller.ts` | Xem §2.4 |
| R12 | Gateway `/health` không gồm payment/notification/review/promotion | THẤP | `gateway/health/health.controller.ts` | Thêm `checkTcpService` cho 4 service còn lại |
| R13 | `POST /user/register` tạo user `permissions=0`, không tự gán role Customer → user mới không dùng được API cần quyền | TB | `user.service.ts register` | Tự gán role mặc định khi đăng ký |
| R14 | Tiền `decimal(10,2)` có thể không đủ cho VND | THẤP | `order.entity.ts` | Nới `precision` hoặc dùng integer |
| R15 | Provider thanh toán bind cứng Simulated (`useClass`), không chọn theo env | THẤP | `payment.module.ts` | `useFactory` theo `ConfigService` |

> Các mục R1–R3 nên xử lý **trước** khi mở ra ngoài môi trường dev (đều liên quan phân quyền theo chủ sở hữu, hiện hoàn toàn chỉ có phân quyền theo module/action).

---

## 6. Hiệu năng & vận hành

| Điểm | Hiện trạng | Hệ quả / hướng |
|---|---|---|
| Product catalog | Không cache (Redis có sẵn) | `getProducts` ILIKE `%q%` không dùng index → chậm với 50.000 sản phẩm seed; cần trigram index hoặc search engine |
| `GetOrders` | Không phân trang | Trả toàn bộ đơn; cần `PaginationQueryDto` (đã có ở libs/common) |
| `getReviewsByProduct` | Không phân trang, không tổng hợp rating | Cần aggregate + cache |
| Auth per request | 1 TCP + Redis + DB | Cache ngắn hạn tại Gateway (§1.2) |
| Outbox poll 1s | Quét liên tục | Index `(status, createdAt)`; NOTIFY/LISTEN hoặc broker khi tải lớn |
| Observability | Tracing + Prometheus + Grafana đã nối | Chưa có alert rule (Outbox FAILED, breaker open, saga compensation fail) |
| Test | Chủ yếu spec sơ sài; e2e mẫu | Chưa phủ saga/refund/outbox — nên ưu tiên test đường compensation |
| Scale ngang | Outbox/cron, host `localhost` | Cần leader election/`SKIP LOCKED` và cấu hình host |

---

## 7. Quyết định đã chốt vs cần chốt

**Đã chốt (code phản ánh)**: TCP-only; Gateway entry duy nhất; CQRS cho service nghiệp vụ; Saga + Outbox cho checkout; kho trừ ngay + optimistic lock; voucher dùng pessimistic lock; session qua Redis; RBAC bitmask; provider (payment/email/push) trừu tượng hoá qua DI, mặc định Simulated.

**Cần chốt (ảnh hưởng thiết kế)**
1. Có giữ TCP khi lên nhiều instance, hay quay lại broker? (quyết định mức bảo đảm giao event)
2. Ai là nguồn sự thật về giá khi tạo đơn: Gateway hay Orders? Có đóng `POST /orders`?
3. Chính sách hoàn kho khi huỷ/refund và TTL cho đơn `PENDING`.
4. Voucher: áp dụng trong saga (trừ lượt khi đơn thành công) hay tại bước "apply" như hiện tại?
5. Payment thật: đồng bộ (như hiện tại) hay bất đồng bộ qua webhook (cần Orders nghe event/webhook)?
6. Ownership/ABAC: bổ sung kiểm tra theo chủ sở hữu ở Gateway hay trong từng service?
7. Có cần endpoint refresh token / role mặc định khi register?

---

## 8. Tài liệu liên quan
- [business-flows.md](./business-flows.md) · [module-processing-flows.md](./module-processing-flows.md)
- [system-architecture.md](./system-architecture.md) · [system-architecture-orders-flow.md](./system-architecture-orders-flow.md)
- [project-roadmap.md](./project-roadmap.md)
