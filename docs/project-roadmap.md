# Project Roadmap

**Ngày cập nhật**: 2026-10-15
**Trạng thái**: Early-stage, Phase 0-2 đã hoàn thành, **Checkout v2 (event-driven) đã cutover và kiểm chứng trên stack thật một phần** (migration, 33/33 int-spec, E2E E-01…E-13 PASS; còn E-14, k6), Phase 3 đang lên kế hoạch

---

## Trạng thái hiện tại

Hệ thống ecommerce microservices đang ở giai đoạn **early-stage development**, hạ tầng lõi và các domain nghiệp vụ chính đã được implement qua 3 phase. RPC đồng bộ giữa service qua TCP, event/command bất đồng bộ qua Kafka (Outbox/Inbox) sau cutover checkout v2; database migration và setup observability ban đầu đã có. Hệ thống hiện mang tính **học tập** (chạy trên localhost) hơn là production-ready.

### Trạng thái implementation theo Phase

| Phase | Trạng thái | Kết quả chính |
|-------|--------|-----------------|
| **Phase 0: Foundations** | ✅ XONG | Health check, graceful shutdown, DB migrations, idempotency, outbox pattern |
| **Phase 1: Core Domain** | ✅ XONG | User auth (JWT+bcrypt), Product catalog (CQRS), Cart, Saga checkout, Inventory management, RBAC (bitmask), Address book |
| **Phase 2: Ecosystem** | ✅ XONG | Payment (simulate), Notification (email scaffold), Review kèm purchase verification, Promotion (voucher có locking), Media (MinIO) |
| **Checkout v2 (event-driven)** | ✅ Code xong; ✅ kiểm chứng DB/Kafka thật (E-01…E-13); ⏳ E-14, k6 | Kafka + Outbox/Inbox, Inventory (reserve/commit/release), Payment intent + webhook + refund, Shipping, Voucher nối checkout, huỷ/hoàn hàng, scheduler, Gateway checkout chọn món + idempotency bắt buộc + simulator; Saga cũ đã xoá. Xem [target-checkout-architecture.md §10](./target-checkout-architecture.md) |
| **Phase 3: Production Hardening** | 🔄 TODO | Hoàn thiện observability, API docs, security audit, real payment/email provider, search indexing |

---

## Chi tiết từng Phase

### Phase 0: Foundations & Reliability ✅

**Mục tiêu**: Xây nền hạ tầng đáng tin cậy trước khi làm domain logic.

**Đã hoàn thành**:
- ✅ Khởi tạo database, framework migration (tổng 8 migration)
- ✅ Cấu hình connection pool (Postgres: max:50, min:5)
- ✅ Health check endpoint (`GET /health` kèm status check)
- ✅ Graceful shutdown (SIGTERM → chờ request đang xử lý → đóng kết nối)
- ✅ Hỗ trợ idempotency (header x-idempotency-key, lưu Redis, TTL 24h)
- ✅ Scaffold outbox pattern (ban đầu là worker @Cron at-most-once; đã thay bằng relay Kafka at-least-once ở checkout v2)
- ✅ Exception filter (base `AbstractRpcExceptionFilter` + subclass riêng từng service)
- ✅ Setup tracing (tích hợp OpenTelemetry + Jaeger)
- ✅ Docker Compose (Postgres, Redis, Kafka KRaft, Jaeger, Prometheus, Grafana, MinIO, exporter postgres/redis/kafka)

**Tham khảo**: `plans/260925-1612-production-readiness-roadmap/phase-00-foundations-reliability.md`

---

### Phase 1: Core Domain Features ✅

**Mục tiêu**: Implement các domain nghiệp vụ chính (User, Product, Orders, RBAC).

**Đã hoàn thành**:

#### User Service
- ✅ Đăng ký (hash password bằng bcrypt)
- ✅ Login/Logout (JWT access+refresh token, refresh lưu trong Redis)
- ✅ Verify token (JwtAuthGuard gọi User.VERIFY_TOKEN qua TCP)
- ✅ Sổ địa chỉ (CRUD, theo dõi địa chỉ mặc định)
- ✅ Role-based access control (RBAC qua bitmask permissions)
- ✅ Quản lý avatar user (tích hợp MinIO)
- **Ghi chú**: Không dùng CQRS (chủ ý giữ đơn giản dạng CRUD)

#### Product Service
- ✅ CRUD Product (name, price, images dạng JSONB; tồn kho đã chuyển sang Inventory)
- ✅ Quản lý Category & Brand
- ✅ Product variant (sku, price riêng từng variant)
- ✅ Attribute & attribute value
- ✅ ~~Optimistic locking khi adjust stock~~ → chuyển sang Inventory (`stock_items`, khoá `ORDER BY id FOR UPDATE`) và Order (`version`)
- ✅ Implement đầy đủ CQRS (commands/queries/handlers/events)
- **Gap**: Chưa có Redis caching (mọi read đều hit thẳng Postgres) — roadmap item

#### Orders Service (phức tạp nhất)
- ✅ Quản lý cart (lưu Redis, TTL 30 ngày)
- ✅ ~~Checkout Saga đồng bộ~~ → **đã thay bằng checkout v2** (xem mục "Checkout v2" bên dưới): reserve kho TTL → Order `PENDING_PAYMENT` → payment intent → thanh toán/webhook → commit kho → vận chuyển, điều phối bằng Outbox → Kafka
- ✅ State machine cho Order (nay: PENDING_PAYMENT → PAID → FULFILLING → SHIPPED → DELIVERED → COMPLETED, +CANCELLED, +REFUNDING → REFUNDED; khoá lạc quan `version`)
- ✅ Hoàn tiền thật qua Payment (huỷ khi chưa ship, hoàn hàng trong 7 ngày); workflow refund PENDING/APPROVED/REJECTED cũ đã xoá
- ✅ Transactional Outbox → Kafka at-least-once (thay `OutboxWorker` TCP at-most-once)
- ✅ Implement đầy đủ CQRS
- ✅ Các gap cũ đã đóng: tin `unitPrice`/`userId` từ client (route `POST /orders` đã xoá, giá/số lượng server-side), refund không hoàn tiền thật, Saga không có state bền

**Tham khảo**: `plans/260925-1612-production-readiness-roadmap/phase-01-core-domain-features.md`

---

### Phase 2: Ecosystem Expansion ✅

**Mục tiêu**: Tích hợp payment, notification, review, promotion, media.

**Đã hoàn thành**:

#### Payment Service
- ✅ `SimulatedPaymentProvider` (luôn thành công, phục vụ test)
- ✅ Theo dõi payment transaction (`idempotencyKey` unique, chống charge trùng)
- ✅ Verify chữ ký webhook bằng HMAC-SHA256
- ✅ Dedup webhook (`PaymentWebhookLog.eventId`)
- ✅ (Sau checkout v2) payment intent + webhook → outbox `PaymentSucceeded/Failed` qua Kafka; `CHARGE_PAYMENT` và emit TCP trực tiếp đã xoá
- **Roadmap**: Provider thật (vnpay, momo) — đã có scaffold, chọn qua env

#### Notification Service
- ✅ Event listener (nay: Kafka `order-events` — `OrderCreated`, `OrderStatusChanged`, có Inbox)
- ✅ Flow gửi email (lấy email user, gửi qua `EmailProvider`)
- ✅ `SimulatedEmailProvider` (mặc định, chỉ log)
- **Roadmap**: Provider thật (Resend, Brevo), push notification (Firebase FCM)
- **Gap**: `PushProvider` đã đăng ký nhưng chưa controller nào gọi (push notification chưa hoạt động)

#### Review Service
- ✅ Tạo review kèm verify đã mua hàng (gọi TCP tới Orders để verify chủ order + trạng thái đã giao)
- ✅ Hỗ trợ rating & comment
- ✅ CQRS đầy đủ
- ✅ Hỗ trợ soft-delete

#### Promotion Service
- ✅ Quản lý voucher (code, loại/giá trị discount, ngày hết hạn, giới hạn số lần dùng)
- ✅ ApplyVoucher dùng pessimistic locking (tránh dùng vượt giới hạn khi có concurrent request)
- ✅ CQRS đầy đủ; (sau checkout v2) validate/reserve/release/confirm nối checkout + consumer `order-events`

#### Media (MinIO)
- ✅ File storage tương thích S3 (tự tạo bucket)
- ✅ Upload & lưu ảnh sản phẩm
- ✅ Upload & lưu avatar user
- ✅ Sinh presigned URL (link tải tạm thời)

**Tham khảo**: `plans/260925-1612-production-readiness-roadmap/phase-02-ecosystem-expansion.md`

---

### Checkout v2 — Event-driven (cutover 2026-10-15) ✅ code / ✅ kiểm chứng một phần trên stack thật

**Mục tiêu**: thay Saga đồng bộ bằng orchestration event-driven (thiết kế: [target-checkout-architecture.md](./target-checkout-architecture.md); plan + báo cáo từng phase: `plans/261015-1700-checkout-v2-event-driven/`).

**Đã hoàn thành (code + unit test mock + `nest build` 10 app)**:
- ✅ Nền tảng messaging `libs/messaging` (Kafka, outbox relay at-least-once, inbox, consumer runner retry 3 → DLQ)
- ✅ `apps/inventory` (:3008): reserve/commit/release/restock, `replaces`, job hết hạn
- ✅ `apps/shipping` (:3009): carrier mô phỏng, retry 3 → DLQ → `ShipmentFailed`, webhook giao hàng HMAC
- ✅ Payment intent + webhook → outbox + refund + simulator; Gateway `/simulator/*`
- ✅ Orders: state machine mới + khoá lạc quan, checkout đồng bộ (chốt #1/#2/#3), consumer payment/inventory/shipping, huỷ/hoàn hàng, scheduler 30s/10 phút
- ✅ Voucher nối checkout (validate → reserve → confirm/release)
- ✅ Gateway: checkout chọn món, idempotency bắt buộc (fail-closed), `GET /orders/:id/pay`, huỷ/hoàn, simulator, catalog ghép tồn kho
- ✅ Cutover: xoá Saga cũ (`CreateOrderHandler`, `saga/`, `CHARGE_PAYMENT`, `ADJUST_STOCK` của Product, `POST /orders`, `PATCH /orders/:id/status`, `/refunds*`), migration chốt, cập nhật seed/loadtest/http/docs

**Đã làm trên stack thật**: migration (DB test up/down/up; DB dev đã áp), 33/33 int-spec, E2E E-01…E-13 (kết quả và bug đã sửa: `reports/e2e-test-report.md`).

**Việc còn lại**: chạy E-14 (tắt Kafka 30 giây, cần đồng ý vì Kafka dùng chung); k6 và lưu số đo; seed lại (`scripts/seed.ts` đang trỏ cứng DB `ecommerce`); chọn phương án cho F1 (message bị bỏ khi consumer down, [design-trade-offs §5 R20](./design-trade-offs.md)).

---

### Phase 3: Production Hardening 🔄 TODO

**Mục tiêu**: Sẵn sàng cho production (hoàn thiện observability, security, tích hợp provider thật).

**Kế hoạch**:

#### Observability (đã wiring, config chưa đầy đủ)
- 🔄 Capture đầy đủ trace Jaeger (đã gọi `setupTracing` nhưng chưa trace hết mọi tương tác)
- 🔄 Expose Prometheus metrics từng service (đã cấu hình port nhưng chưa expose hết metrics)
- 🔄 Grafana dashboard: đã có 3 dashboard (Server Overview, Infrastructure, k6). Metric PostgreSQL và truy vấn tuỳ biến chưa kiểm trên exporter thật
- 🔄 Tập trung log (tuỳ chọn Loki qua Grafana)
- 🔄 Alert rule (tuỳ chọn Prometheus + Grafana alerting)

#### Security & Hardening
- 🔄 Kiểm tra rate limiting (lưu Redis, mặc định 100/phút, 5/phút cho login/register — đã implement nhưng chưa test kỹ)
- 🔄 Enforce API key (middleware gateway check x-api-key — đã implement nhưng validate chưa đầy đủ)
- 🔄 Hardening CORS (đã có env `CORS_ORIGINS`, cần tinh chỉnh theo từng environment)
- 🔄 Audit security headers (đã bật Helmet, cần review lại cấu hình)
- 🔄 Chiến lược xoay vòng credential database (chưa xử lý)
- 🔄 Quản lý secret (hiện env var local, chưa có vault)

#### API Documentation
- 🔄 Tích hợp Swagger (`@nestjs/swagger` mới wiring 1 phần)
- 🔄 Document API endpoint (comment DTO + Swagger decorator chưa đầy đủ)
- 🔄 Document error response (đã định nghĩa format nhưng chưa viết tài liệu)
- 🔄 Ví dụ payload (thiếu ví dụ request/response)

#### Testing & Quality
- 🔄 Audit test coverage (mục tiêu 70% cho code mới, chưa có report coverage)
- 🔄 Bộ test E2E: runbook thủ công E-01…E-13 đã PASS trên stack thật; E-14 (Kafka outage) chưa chạy; chưa tự động hoá
- 🔄 Load testing: kịch bản k6 và compose giới hạn 4 vCPU / 8 GB đã có; chưa có số đo sau cutover
- 🔄 Chaos engineering / test failure scenario (chưa có test Kafka outage; resilience rộng hơn chưa làm)

#### Tích hợp Provider thật
- 🔄 Payment: vnpay/momo (đã có scaffold, chọn qua env, chưa test end-to-end)
- 🔄 Email: Resend/Brevo (đã có adapter, thiếu config credentials)
- 🔄 Push: Firebase FCM (đã wiring nhưng chưa được gọi, cần config)

#### Search & Discovery
- 🔄 Full-text search (tương lai: container Elasticsearch/OpenSearch)
- 🔄 Index sản phẩm (tương lai: tự động sync từ `ProductCreatedEvent`)
- 🔄 API search (tương lai: endpoint mới trong gateway)

**Ước tính**: 2-4 tuần tuỳ phạm vi (chỉ wiring hay hardening đầy đủ).

**Tham khảo**: `plans/260925-1612-production-readiness-roadmap/phase-03-production-hardening.md`

---

## Known Gaps & Limitations (Các gap đã biết)

### Gap nghiêm trọng (nên fix sớm)

Chi tiết bằng chứng/đề xuất: [design-trade-offs.md §5](./design-trade-offs.md#5-rủi-ro--gap-đã-xác-minh-trong-code).

| Gap | Ảnh hưởng | Ưu tiên | Ghi chú |
|-----|--------|----------|-------|
| ~~Tin `unitPrice` + `userId` từ client ở `POST /orders`~~ | **Đã đóng** (route xoá; giá/số lượng server-side) | — | R1 |
| Thiếu kiểm tra chủ sở hữu (`GET /orders*`, `GET /orders/:id/refunds`, addresses) | Đọc/sửa dữ liệu của user khác; `GET /orders` không `userId` trả mọi đơn | CAO | Mới có phân quyền theo module/action (R2, R3); `/orders/:id/pay\|cancel\|return` đã kiểm tra |
| ~~Saga không có state bền~~ / ~~Webhook chưa cập nhật Order~~ / ~~Outbox at-most-once~~ | **Đã đóng** bằng orchestration + outbox/inbox Kafka; đã kiểm chứng E2E | — | §2.1, §2.4 trade-offs |
| F1: consumer `fromBeginning:false` làm mất message khi service down; đơn kẹt `FULFILLING` | Đã tái hiện trên stack thật; chưa có reconcile | CAO | Chọn phương án (trade-offs §7, mục 8) |
| Checkout v2 chưa kiểm: E-14 (Kafka outage), k6 sau cutover, seed | Outbox giữ PENDING khi broker tắt chưa được chứng minh; chưa có số tải | TRUNG BÌNH | Chạy E-14 (cần đồng ý) và k6 |
| Crash giữa `RESERVE_VOUCHER` và TX tạo đơn; `replaces` mất reservation khi TX lỗi | Kẹt lượt voucher / link thanh toán chết | TRUNG BÌNH | R16 |
| Hoàn tiền `FAILED` không retry; hoàn hàng gặp `PaymentRefundFailed` kẹt `REFUNDING` | Cần admin xử lý tay | TRUNG BÌNH | R18 |
| Idempotency Gateway get-then-set không nguyên tử | Hai request đồng thời cùng key có thể cùng lọt | TRUNG BÌNH | R8; thêm `SET NX` vào `libs/cached` |
| DLQ/outbox `FAILED` chưa có alert/replay | Event thất bại chỉ có metric | TRUNG BÌNH | R11 |
| `/vouchers/apply` cũ | Tiêu lượt không gắn đơn | THẤP | R7 |
| Register không gán role mặc định | User mới không gọi được API cần quyền | TRUNG BÌNH | R13 |
| Chưa cache Product / search ILIKE không index | Hiệu năng với 50.000 sản phẩm seed | TRUNG BÌNH | Có sẵn libs/cached |
| Push notification | Tính năng chưa xong | THẤP | PushProvider đã wiring nhưng chưa handler nào gọi |

### Gap không quan trọng (có thể trì hoãn)

| Gap | Ảnh hưởng | Ưu tiên | Ghi chú |
|-----|--------|----------|-------|
| Thiếu .env.example | Khó onboard dev mới | THẤP | Chưa có tài liệu env cho dev mới |
| Event handler còn stub | Observability/search | THẤP | `ProductCreatedEvent` chỉ console.log (tương lai Kafka→Elasticsearch) |
| Payment/Shipping provider thật | Tính năng chưa xong | THẤP | Chỉ simulator (đã chốt); thay cổng thật = thêm provider, ký raw body |
| Email provider thật | Tính năng chưa xong | THẤP | `SimulatedEmailProvider` hoạt động tốt, Resend/Brevo thật chưa test |
| Refresh token | UX | THẤP | **Xác nhận không có endpoint refresh** — access token 15 phút hết hạn phải login lại |
| Kiến trúc User service | Tính nhất quán | THẤP | Không dùng CQRS (khác các service kia); có thể là chủ ý vì đơn giản |

### Dead code / Candidate dọn dẹp

| Mục | Vị trí | Hành động |
|------|----------|--------|
| Hằng số CMD cũ | libs/common/src/constant/cmd.ts | Vẫn được User và Notification dùng (`CMD.GET_USER_INFO`). Chuyển sang `USER_MESSAGE_PATTERN` rồi xoá |
| Dependency RabbitMQ | package.json | Gỡ amqp-connection-manager, amqplib (không còn import nào; kênh bất đồng bộ là Kafka) |
| `gateway.controller.spec.ts`, `user.controller.spec.ts` | apps/gateway/src, apps/user/src | Boilerplate đang fail (thiếu provider `USER_SERVICE`; parse error): sửa hoặc xoá |
| Cột `refunds.status` APPROVED/REJECTED | apps/orders entity | Không còn code ghi; cân nhắc gỡ khỏi enum |

---

## Phụ thuộc giữa các Phase

```
Phase 0 (Foundations)
├─ Health, DB migrations, Outbox pattern ✅
└─ Điều kiện tiên quyết cho Phase 1 (Saga cần outbox + idempotency)
   ↓
Phase 1 (Core Domains: User, Product, Orders)
├─ User auth ✅
├─ Product inventory ✅
├─ Order Saga + transactional outbox ✅
└─ Điều kiện tiên quyết cho Phase 2 (Payment phụ thuộc Order state machine)
   ↓
Phase 2 (Ecosystem: Payment, Notification, Review, Promotion, Media)
├─ Tích hợp Payment ✅
├─ Flow event Notification ✅
├─ Verify Review ✅
├─ Promotion + locking ✅
└─ Điều kiện tiên quyết cho Phase 3 (Provider thật, hardening)
   ↓
Phase 3 (Production Hardening)
├─ Wiring observability
├─ Tích hợp provider thật
├─ Security audit
└─ Sẵn sàng deploy
```

Không có vấn đề backward compatibility; các phase sau đều dựa trên phase trước.

---

## Decision Log

### Quyết định đã chốt (Phase 0-2)

| Quyết định | Lý do | Trạng thái |
|----------|-----------|--------|
| ~~Không dùng RabbitMQ / không broker~~ | TCP point-to-point đủ dùng lúc đầu | ⛔ **Đã đảo 2026-10-15**: thêm Kafka cho event/command (RabbitMQ vẫn không dùng) |
| **Transactional Outbox** | Ghi event cùng transaction với đổi trạng thái order; nay relay Kafka at-least-once + Inbox (xem trade-offs §2.4) | ✅ Đã implement (int-spec relay và producer pass trên Kafka thật; E2E PASS) |
| **Simulate trước, thật sau** | Học pattern mà không vướng tài khoản bên thứ 3; provider qua DI token (hiện bind cứng Simulated, chưa chọn theo env) | ✅ Đã implement (phần chọn theo env: TODO) |
| **RBAC dạng bitmask** | Check permission hiệu quả bằng phép toán bit | ✅ Đã implement |
| **Optimistic locking** | Nay áp dụng ở **Order** (`UPDATE ... WHERE version`); Product không còn trừ kho | ✅ Đã implement |
| **Pessimistic locking (Promotion)** | Quan trọng: tránh voucher dùng vượt giới hạn; thời gian lock ngắn nên chấp nhận được | ✅ Đã implement |
| **Không dùng SMS OTP** | Email OTP đã đủ; SMS tốn thêm chi phí/độ phức tạp | ✅ Đã quyết định, dùng Email |

### Quyết định đã chốt 2026-10-15 (checkout v2 — đã implement; kiểm chứng một phần)

Chi tiết: [target-checkout-architecture.md](./target-checkout-architecture.md).

| Quyết định | Lý do | Trạng thái |
|----------|-----------|--------|
| **Thêm Kafka cho event/command bất đồng bộ** (đảo quyết định "không dùng RabbitMQ"; RPC đồng bộ vẫn TCP) | Outbox TCP at-most-once, mất event là kẹt đơn; orchestration cần at-least-once + inbox | ✅ Đã implement (`libs/messaging`) |
| **Tách `apps/inventory` (:3008)** với reserve/commit/release + TTL 15' | Hết trừ kho thật lúc checkout; tự dọn đơn bỏ dở | ✅ Đã implement |
| **Thêm `apps/shipping` (:3009)**, carrier mô phỏng | Có vòng đời SHIPPED/DELIVERED thật | ✅ Đã implement |
| **State machine mới** PENDING_PAYMENT→PAID→FULFILLING→SHIPPED→DELIVERED→COMPLETED (+REFUNDING→REFUNDED) | Khớp luồng orchestrated | ✅ Đã implement + migration chốt |
| **Chỉ Simulated cho Payment/Shipping** (không tích hợp ngoài), nhưng đi qua intent + webhook HMAC thật; hoãn vnpay/momo | Học pattern không vướng tài khoản bên thứ 3 | ✅ Đã implement |
| **Payment async** (`createIntent` + webhook), nối Voucher, job hết hạn/auto COMPLETED | Loại bỏ cửa sổ lỗi charge-timeout/đơn kẹt PENDING | ✅ Đã implement |
| **Cutover một lần, không feature flag**; xoá Saga cũ; `PENDING/PROCESSING` → `PENDING_PAYMENT` (huỷ ngay, chấp nhận vì chỉ có dữ liệu seed) | Giảm độ phức tạp song song hai luồng | ✅ Đã thực hiện; migration đã chạy trên DB test và dev |
| **Giữ `/vouchers/apply`; xoá `POST /orders`, `PATCH /orders/:id/status`, `/refunds*`** | Route cũ tin dữ liệu client / đổi trạng thái tay | ✅ Đã thực hiện |

### Quyết định cần chốt (Phase 3 sắp tới)

Các câu hỏi thiết kế còn mở (nguồn giá, hoàn kho khi huỷ, voucher trong saga, payment async, ownership check, refresh token): xem [design-trade-offs.md §7](./design-trade-offs.md#7-quyết-định-đã-chốt-vs-cần-chốt).

| Quyết định | Lựa chọn | Đề xuất | Trạng thái |
|----------|---------|-----------------|--------|
| **Search engine** | Elasticsearch vs. OpenSearch vs. hoãn lại | Bắt đầu với OpenSearch chạy local (miễn phí, tự host) | 🔄 TODO |
| **Tập trung log** | ELK vs. Loki vs. bỏ qua | Loki qua Grafana (nhẹ hơn, đã có sẵn Grafana) | 🔄 TODO |
| **Payment provider thật** | vnpay vs. momo vs. hoãn lại | Bắt đầu với vnpay (tài liệu tiếng Anh nhiều hơn), momo là phương án dự phòng | 🔄 TODO |
| **Admin back-office** | SPA React/Vue vs. route admin trong gateway | Tách app React riêng, chặn qua API key (sạch hơn, dễ scale) | 🔄 TODO |
| **Deployment target** | K8s vs. Docker compose vs. vẫn local | Giữ local (mục tiêu học tập), deployment để sau | ✅ Đã quyết định, chỉ Local |
| **CI/CD** | GitHub Actions vs. GitLab CI vs. bỏ qua | Bỏ qua tạm thời (mục tiêu học tập, không public) | ✅ Đã quyết định, bỏ qua |

---

## Success Metrics (Phase hiện tại)

### Tiêu chí thành công Phase 0-2 (Đã đạt ✅)

- ✅ Mọi service có health check + graceful shutdown
- ✅ ~~Saga pattern đã verify bằng test~~ → đã thay bằng checkout v2; bù trừ được kiểm bằng unit test và E2E (E-04, E-05, E-11)
- 🔄 Test coverage ≥70% cho critical path: chưa có báo cáo coverage
- ✅ Flow checkout end-to-end (checkout v2): E-01…E-13 PASS trên stack thật (E-14 chưa chạy)
- ✅ Không phụ thuộc RabbitMQ (nay dùng Kafka cho event)
- ✅ Service giao tiếp qua TCP (RPC) và Kafka (event/command); không truy cập bảng của service khác

### Tiêu chí thành công Phase 3 (Mục tiêu)

- [ ] Jaeger trace capture 100% các cuộc gọi giữa service
- [ ] Prometheus scrape thành công endpoint /metrics của cả 10 service (`prometheus.yml` đã có đủ 10 target; chưa xác nhận scrape thật)
- [ ] Grafana dashboard hiển thị health, latency, error rate của service
- [ ] Mọi API endpoint đã document trong Swagger
- [ ] Payment provider thật (vnpay) đã test end-to-end
- [ ] Email provider thật (Resend/Brevo) đã test end-to-end
- [ ] Push notification (FCM) hoạt động
- [ ] Report test coverage đạt ≥70% cho mọi service
- [ ] Hoàn thành security audit (không có finding nghiêm trọng)
- [ ] Load test verify được ≥500 concurrent request/service

---

## Roadmap Timeline (Ước tính)

| Phase | Thời lượng | Bắt đầu | Kết thúc | Trạng thái |
|-------|----------|-------|-----|--------|
| Phase 0 | 2 tuần | 01/09 | 15/09 | ✅ XONG |
| Phase 1 | 3 tuần | 15/09 | 06/10 | ✅ XONG |
| Phase 2 | 2 tuần | 06/10 | 20/10 | ✅ XONG |
| Phase 3 | 4 tuần | 20/10 | 17/11 | 🔄 Đang làm |
| **Stretch**: Admin UI | 2 tuần | 17/11 | 01/12 | 📅 Kế hoạch |
| **Stretch**: Provider thật + search | 2 tuần | 01/12 | 15/12 | 📅 Kế hoạch |

---

## Cách dùng Roadmap này

1. **Theo dõi tiến độ**: cập nhật trạng thái từng phase khi hoàn thành
2. **Xác định blocker**: tham khảo mục "Known Gaps" khi lên kế hoạch sprint
3. **Ưu tiên tính năng**: gap đánh dấu CRITICAL nên xử lý trước khi vào Phase 3
4. **Tham khảo plan chi tiết**: đọc từng phase tại `plans/260925-1612-production-readiness-roadmap/phase-XX-*.md`

---

## Next Steps (Để bắt đầu Phase 3)

1. **Tạo plan chi tiết cho Phase 3** (checklist các task cụ thể)
2. **Chọn khu vực ưu tiên**: wiring observability hay tích hợp provider thật trước?
3. **Hoàn tất kiểm chứng checkout v2** (E-14, k6, seed) và chọn phương án F1; rồi fix gap nghiêm trọng (ownership check, cache product) trước khi hardening
4. **Setup CI/CD** (GitHub Actions với bước lint, test, build)
5. **Thực hiện security audit** (review code cho auth, xử lý dữ liệu, secret)
6. **Load testing** (verify hệ thống scale được tới mức concurrency mục tiêu)

---

## Câu hỏi & vấn đề mở

- [ ] Admin back-office nên làm trong Phase 3 hay để sau khi launch?
- [ ] Ưu tiên payment provider thật nào trước (vnpay hay momo)?
- [ ] Cache product nên làm trước Phase 3 (ngay bây giờ) hay để làm optimization trong Phase 3?
- [x] ~~Vấn đề unitPrice do client cung cấp~~ — đã đóng (giá server-side)
- [ ] Có nên xem lại SMS OTP, hay email OTP là đủ về lâu dài?
- [ ] Deployment target đã chốt local, hay vẫn để ngỏ khả năng dùng K8s sau này?

**Hành động**: Trao đổi các câu hỏi này trước khi lên kế hoạch thực thi Phase 3.
