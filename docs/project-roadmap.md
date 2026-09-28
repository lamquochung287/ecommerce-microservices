# Project Roadmap

**Ngày cập nhật**: 2026-09-28
**Trạng thái**: Early-stage, Phase 0-2 đã hoàn thành, Phase 3 đang lên kế hoạch

---

## Trạng thái hiện tại

Hệ thống ecommerce microservices đang ở giai đoạn **early-stage development**, hạ tầng lõi và các domain nghiệp vụ chính đã được implement qua 3 phase. Tất cả service đã giao tiếp qua TCP, database migration chạy được, và đã có setup observability ban đầu. Hệ thống hiện mang tính **học tập** (chạy trên localhost) hơn là production-ready.

### Trạng thái implementation theo Phase

| Phase | Trạng thái | Kết quả chính |
|-------|--------|-----------------|
| **Phase 0: Foundations** | ✅ XONG | Health check, graceful shutdown, DB migrations, idempotency, outbox pattern |
| **Phase 1: Core Domain** | ✅ XONG | User auth (JWT+bcrypt), Product catalog (CQRS), Cart, Saga checkout, Inventory management, RBAC (bitmask), Address book |
| **Phase 2: Ecosystem** | ✅ XONG | Payment (simulate), Notification (email scaffold), Review kèm purchase verification, Promotion (voucher có locking), Media (MinIO) |
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
- ✅ Scaffold outbox pattern (entity Order+Outbox, worker @Cron)
- ✅ Exception filter (base `AbstractRpcExceptionFilter` + subclass riêng từng service)
- ✅ Setup tracing (tích hợp OpenTelemetry + Jaeger)
- ✅ Docker Compose (Postgres, Redis, Jaeger, Prometheus, Grafana, MinIO)

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
- ✅ CRUD Product (name, price, stock, images dạng JSONB)
- ✅ Quản lý Category & Brand
- ✅ Product variant (sku, price, stock riêng từng variant)
- ✅ Attribute & attribute value
- ✅ Optimistic locking khi adjust stock (`@VersionColumn` kèm retry)
- ✅ Implement đầy đủ CQRS (commands/queries/handlers/events)
- **Gap**: Chưa có Redis caching (mọi read đều hit thẳng Postgres) — roadmap item

#### Orders Service (phức tạp nhất)
- ✅ Quản lý cart (lưu Redis, TTL 30 ngày)
- ✅ Checkout Saga pattern (nhiều bước, có compensation):
  1. Reserve inventory (qua TCP tới Product)
  2. Tạo Order+Items (DB transaction)
  3. Charge payment (qua TCP tới Payment, có idempotency key)
  4. Confirm order (cập nhật status, transactional outbox)
- ✅ State machine cho Order (PENDING → PROCESSING → PAID → SHIPPED → DELIVERED, +CANCELLED/REFUNDED)
- ✅ Refund workflow (PENDING → APPROVED/REJECTED → COMPLETED)
- ✅ Transactional Outbox (đảm bảo event không mất)
- ✅ OutboxWorker (@Cron EVERY_SECOND, batch 20, retry tối đa 5 lần)
- ✅ Implement đầy đủ CQRS
- **Gap đã biết**:
  - `unitPrice` lấy từ DTO của client, Orders service (`CreateOrderHandler`) không tự re-validate lại với giá gốc từ Product (price-trust gap ở tầng Orders). Gateway's `/cart/checkout` (flow khách hàng dùng) có che chắn bằng cách set `unitPrice` server-side từ Product trước khi gọi Orders, nhưng endpoint `/orders` tạo trực tiếp vẫn forward giá client gửi không kiểm tra
  - Refund→Payment compensation (cơ chế hoàn tiền thật) chưa implement
  - Full refund trên order đang PAID/SHIPPED sẽ không tự động chuyển sang REFUNDED (edge case của state machine)

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
- ✅ Emit event `payment_succeeded`/`payment_failed` tới Orders
- **Roadmap**: Provider thật (vnpay, momo) — đã có scaffold, chọn qua env

#### Notification Service
- ✅ Event listener (`order.created`, `order.status_updated`)
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
- ✅ CQRS đầy đủ, tự chứa (không gọi service nào khác ngoài DB)

#### Media (MinIO)
- ✅ File storage tương thích S3 (tự tạo bucket)
- ✅ Upload & lưu ảnh sản phẩm
- ✅ Upload & lưu avatar user
- ✅ Sinh presigned URL (link tải tạm thời)

**Tham khảo**: `plans/260925-1612-production-readiness-roadmap/phase-02-ecosystem-expansion.md`

---

### Phase 3: Production Hardening 🔄 TODO

**Mục tiêu**: Sẵn sàng cho production (hoàn thiện observability, security, tích hợp provider thật).

**Kế hoạch**:

#### Observability (đã wiring, config chưa đầy đủ)
- 🔄 Capture đầy đủ trace Jaeger (đã gọi `setupTracing` nhưng chưa trace hết mọi tương tác)
- 🔄 Expose Prometheus metrics từng service (đã cấu hình port nhưng chưa expose hết metrics)
- 🔄 Grafana dashboard (hạ tầng đã sẵn sàng, dashboard chưa điền đầy đủ)
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
- 🔄 Bộ test E2E (đã có framework, test chưa đầy đủ)
- 🔄 Load testing (chưa có bộ load test)
- 🔄 Chaos engineering / test failure scenario (đã có test cho Saga, chưa test resilience rộng hơn)

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

| Gap | Ảnh hưởng | Ưu tiên | Ghi chú |
|-----|--------|----------|-------|
| Tin cậy unitPrice từ client | Rủi ro tamper giá qua endpoint `/orders` trực tiếp | CAO | Orders service không tự validate lại giá; `/cart/checkout` (flow thường) có che chắn nhưng `/orders` trực tiếp thì không |
| Chưa cache Product | Hiệu năng (N+1 reads) | CAO | Product catalog chưa cache dù đã có sẵn libs/cached |
| Refund compensation | Flow refund chưa hoàn chỉnh | TRUNG BÌNH | Chưa có compensation refund→payment provider (cơ chế hoàn tiền chưa rõ) |
| Edge case Order state | State machine chưa nhất quán | TRUNG BÌNH | Full refund trên order PAID/SHIPPED không tự chuyển sang REFUNDED |
| Push notification | Tính năng chưa xong | TRUNG BÌNH | PushProvider đã wiring nhưng chưa handler nào gọi |

### Gap không quan trọng (có thể trì hoãn)

| Gap | Ảnh hưởng | Ưu tiên | Ghi chú |
|-----|--------|----------|-------|
| Thiếu .env.example | Khó onboard dev mới | THẤP | Chưa có tài liệu env cho dev mới |
| Event handler còn stub | Observability/search | THẤP | `ProductCreatedEvent`, `OrderCreatedEvent` chỉ console.log (tương lai Kafka→Elasticsearch) |
| Payment provider thật | Tính năng chưa xong | THẤP | `SimulatedPaymentProvider` hoạt động tốt, vnpay/momo thật chưa test |
| Email provider thật | Tính năng chưa xong | THẤP | `SimulatedEmailProvider` hoạt động tốt, Resend/Brevo thật chưa test |
| Flow refresh token của User | UX chưa rõ | THẤP | Chưa có endpoint refresh-token rotation rõ ràng; flow renew phía client chưa rõ |
| Kiến trúc User service | Tính nhất quán | THẤP | Không dùng CQRS (khác các service kia); có thể là chủ ý vì đơn giản |

### Dead code / Candidate dọn dẹp

| Mục | Vị trí | Hành động |
|------|----------|--------|
| Hằng số CMD cũ | libs/common/src/constant/cmd.ts | Xoá (đã được thay bằng libs/constant/message-pattern.constant.ts) |
| Dependency RabbitMQ | package.json | Xoá amqp-connection-manager, amqplib (đã deprecated hoàn toàn, dùng TCP thay thế) |

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
| **Không dùng RabbitMQ** | TCP point-to-point đủ dùng cho mục đích học tập; giảm độ phức tạp | ✅ Đã implement |
| **Transactional Outbox** | Đảm bảo event không mất khi service crash | ✅ Đã implement |
| **Simulate trước, thật sau** | Học pattern mà không vướng tài khoản bên thứ 3; đổi provider qua env | ✅ Đã implement |
| **RBAC dạng bitmask** | Check permission hiệu quả bằng phép toán bit | ✅ Đã implement |
| **Optimistic locking (Product)** | Đọc nhiều, ghi ít; retry logic chấp nhận được | ✅ Đã implement |
| **Pessimistic locking (Promotion)** | Quan trọng: tránh voucher dùng vượt giới hạn; thời gian lock ngắn nên chấp nhận được | ✅ Đã implement |
| **Không dùng SMS OTP** | Email OTP đã đủ; SMS tốn thêm chi phí/độ phức tạp | ✅ Đã quyết định, dùng Email |

### Quyết định cần chốt (Phase 3 sắp tới)

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
- ✅ Saga pattern đã verify bằng test (compensate khi fail)
- ✅ Test coverage ≥70% cho critical path (Saga, Outbox, Stock adjust)
- ✅ Flow checkout end-to-end đầy đủ: đăng ký → xem sản phẩm → thêm giỏ hàng → checkout → thanh toán → notification
- ✅ Không phụ thuộc RabbitMQ (chỉ dùng TCP)
- ✅ Mọi service giao tiếp qua TCP (không truy cập DB chéo service trực tiếp)

### Tiêu chí thành công Phase 3 (Mục tiêu)

- [ ] Jaeger trace capture 100% các cuộc gọi giữa service
- [ ] Prometheus scrape thành công endpoint /metrics của cả 8 service
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
3. **Fix gap nghiêm trọng** (validate unitPrice, cache product) trước khi hardening
4. **Setup CI/CD** (GitHub Actions với bước lint, test, build)
5. **Thực hiện security audit** (review code cho auth, xử lý dữ liệu, secret)
6. **Load testing** (verify hệ thống scale được tới mức concurrency mục tiêu)

---

## Câu hỏi & vấn đề mở

- [ ] Admin back-office nên làm trong Phase 3 hay để sau khi launch?
- [ ] Ưu tiên payment provider thật nào trước (vnpay hay momo)?
- [ ] Cache product nên làm trước Phase 3 (ngay bây giờ) hay để làm optimization trong Phase 3?
- [ ] Vấn đề unitPrice do client cung cấp có thực sự đáng lo cho mục đích học tập (so với production) không?
- [ ] Có nên xem lại SMS OTP, hay email OTP là đủ về lâu dài?
- [ ] Deployment target đã chốt local, hay vẫn để ngỏ khả năng dùng K8s sau này?

**Hành động**: Trao đổi các câu hỏi này trước khi lên kế hoạch thực thi Phase 3.
