# Tổng quan Dự án - Product Development Requirements (PDR)

**Ngày cập nhật**: 2026-09-28  
**Trạng thái**: Early-stage (Phase 00/01/02 được implement)

## Mô tả Dự án

Hệ thống **Ecommerce Microservices** là một nền tảng thương mại điện tử (web-based) được thiết kế theo kiến trúc Microservices bằng NestJS. Dự án nhằm cung cấp một cơ sở học tập toàn diện về các nguyên lý xây dựng hệ thống backend phức tạp, bao gồm:

- Kiến trúc Microservices phân tán với giao tiếp qua TCP
- Quản lý dữ liệu phân tán và tính consistency
- Xây dựng Saga pattern cho các giao dịch phức tạp
- Caching, session management, và observability

Dự án chạy toàn bộ trên **localhost** (Docker Compose), không dùng AWS hoặc hosting public — tập trung vào học tập và phát triển.

## Các Miền Nghiệp vụ (Business Domains)

### 1. Authentication & User Management (`apps/user`)
- **Chức năng chính**:
  - Đăng ký người dùng (register) với bcrypt password hashing
  - Đăng nhập (login) trả về JWT access + refresh token
  - Verify token (dùng để xác thực mỗi request từ Gateway)
  - Logout với thu hồi refresh token từ Redis
  - Quản lý địa chỉ giao hàng (address book) của người dùng
  - Quản lý vai trò và phân quyền (Role-Based Access Control — RBAC) dạng bitmask
  - Cập nhật thông tin cá nhân (avatar, profile)

- **Công nghệ**:
  - JWT (access 15 phút, refresh 7 ngày)
  - Redis lưu refresh token (key: `refresh_token:{userId}:{sessionId}`)
  - Soft-delete cho User entity
  - Bitmask permission model (bitwise AND để kiểm tra quyền)

### 2. Product Catalog & Inventory (`apps/product`)
- **Chức năng chính**:
  - Quản lý sản phẩm (CRUD): tên, mô tả, giá, ảnh, số lượng hàng tồn kho (stock)
  - Quản lý thương hiệu (brand) và danh mục (category) sản phẩm
  - Quản lý biến thể sản phẩm (variant) với mã SKU riêng, giá riêng, stock riêng
  - Quản lý thuộc tính sản phẩm (attribute) dùng cho lọc/tìm kiếm
  - Điều chỉnh stock (adjust) theo yêu cầu từ Order (vd khi confirm đơn → deduct stock)
  - Locking ngạn hàng (reserve stock) khi tạo đơn hàng (để tránh oversell)

- **Công nghệ**:
  - Optimistic locking (@VersionColumn) để tránh race condition khi điều chỉnh stock
  - Soft-delete cho sản phẩm
  - CQRS pattern (commands: CRUD, AdjustStock; queries: GetProducts, GetProduct...)
  - Hình ảnh sản phẩm lưu dạng JSONB (tên file MinIO)
  - **Roadmap**: Redis caching cho product catalog (hiện chưa có)

### 3. Shopping Cart & Orders (`apps/orders`)
- **Chức năng chính**:
  - Quản lý giỏ hàng (cart): thêm/xóa/update sản phẩm, calculate total
  - Tạo đơn hàng (create order) thông qua Saga pattern phức tạp:
    1. Reserve inventory từ Product service
    2. Tạo Order & OrderItem trong DB (status = PENDING)
    3. Charge payment từ Payment service (idempotency key = order.id)
    4. Nếu lỗi → Compensation: release inventory + cancel order
    5. Nếu thanh toán thành công → status = PROCESSING + ghi Outbox event
  - Quản lý trạng thái đơn hàng (state machine): PENDING → PROCESSING → PAID → SHIPPED → DELIVERED
  - Hỗ trợ hủy đơn, hoàn hàng/refund với compensation
  - Transactional Outbox pattern: tách tạo Order + ghi Outbox vào cùng 1 DB transaction để đảm bảo no-lost-event

- **Công nghệ**:
  - Cart lưu trên Redis (key: `cart:{userId}`, TTL 30 ngày)
  - CQRS pattern với event sourcing simulation
  - Outbox pattern + polling worker (@Cron EVERY_SECOND) để fan-out events
  - State machine enforcement (ORDER_STATUS_TRANSITIONS constant)
  - Idempotency key cho charge payment (tránh double-charge)

### 4. Payment Processing (`apps/payment`)
- **Chức năng chính**:
  - Xử lý thanh toán (charge) từ Order service
  - Webhook handler để tiếp nhận kết quả thanh toán từ payment provider
  - Emit payment_succeeded/payment_failed event cho Order service
  - Idempotency key để tránh double-charge

- **Công nghệ**:
  - PaymentProvider interface + SimulatedPaymentProvider (mặc định)
  - Planned: vnpay/momo real providers (chỉ là scaffold, chưa implement)
  - CQRS pattern nhưng không dùng EventBus (emit trực tiếp qua TCP)
  - HMAC-SHA256 signature verification cho webhook

- **Roadmap**: Thực thi real payment provider (VNPay, MoMo)

### 5. Notifications (`apps/notification`)
- **Chức năng chính**:
  - Nhận order events từ Outbox worker (order.created, order.status_updated)
  - Gửi email thông báo cho người dùng
  - Gửi push notification (planned, chưa implement)
  - Lưu log các notifications đã gửi

- **Công nghệ**:
  - Event listener (không CQRS) trên TCP pattern listeners
  - EmailProvider + SimulatedEmailProvider
  - PushProvider + SimulatedPushProvider (wired nhưng không được gọi)
  - Planned: Resend/Brevo cho email, FCM cho push

- **Roadmap**: Kích hoạt push notifications, kết nối real email/push provider

### 6. Reviews & Ratings (`apps/review`)
- **Chức năng chính**:
  - Cho phép người dùng đánh giá sản phẩm (rating 1-5, comment)
  - Xác minh purchase: kiểm tra user đã mua sản phẩm này từ trước (via Order service)
  - Soft-delete review

- **Công nghệ**:
  - CQRS pattern
  - Cross-service call: CreateReviewHandler → Orders TCP (GET_ORDER) → validate purchase

### 7. Promotions & Vouchers (`apps/promotion`)
- **Chức năng chính**:
  - Quản lý voucher (code, discount type, discount value, min order value, expiry, usage limit)
  - Áp dụng voucher vào đơn hàng, calculate discount
  - Pessimistic locking để tránh concurrent voucher over-use

- **Công nghệ**:
  - CQRS pattern
  - DB transaction + row-level lock khi apply voucher
  - Không có outbound TCP calls (self-contained)

## Người Dùng & Nhóm Stakeholder

| Nhóm | Vai trò | Nhu cầu Chính |
|------|--------|-------------|
| **End Users** | Khách hàng mua hàng | Duyệt catalog, thêm cart, checkout, track order, review |
| **Admins/Back-office** | Quản trị hệ thống | Quản lý sản phẩm, đơn hàng, voucher, reports (chưa implement) |
| **Developers/Learners** | Phát triển, học tập | Hiểu kiến trúc, contribute features, study CQRS/Saga pattern |

## Mục Tiêu & Thành Công

### Mục Tiêu Chính
1. **Học tập kiến trúc**: Xây dựng hệ thống Microservices hoàn chỉnh để hiểu rõ nguyên lý design, tradeoff, patterns
2. **Tính reliability**: Đảm bảo consistency (via Saga, Outbox, idempotency), handling failure, graceful shutdown
3. **Scalability foundation**: Chuẩn bị foundation để scale: caching, async processing, observability

### Metrics Thành Công
- Phase 00/01/02 hoàn tất theo roadmap (infra, core features, ecosystem)
- Tất cả services có health check + graceful shutdown
- Saga pattern kiểm chứng bằng test (compensate on failure)
- Test coverage ≥70% cho code mới
- Full end-to-end flow: register → browse products → checkout → receive notification

## Ràng Buộc & Giả Định

| Constraint | Giải thích |
|-----------|----------|
| **No AWS** | Tất cả chạy local qua Docker Compose hoặc free-tier 3rd-party |
| **No Public Deployment** | Project học tập, chỉ chạy localhost — không cần K8s, container registry, hosting |
| **No SMS OTP** | Dùng email OTP thay thế (đã chốt) |
| **Simulate First Strategy** | Payment/Email/Push dùng simulate provider trước, real provider sau (optional) |
| **No RabbitMQ** | Giao tiếp dùng TCP point-to-point, không message broker (RabbitMQ deps là dead code) |

## Timeline & Phases

Xem chi tiết tại [`docs/project-roadmap.md`](./project-roadmap.md) và [`plans/260925-1612-production-readiness-roadmap/plan.md`](../plans/260925-1612-production-readiness-roadmap/plan.md).

Tóm tắt:
- **Phase 0**: Infrastructure, health check, DB migration, Outbox pattern (DONE)
- **Phase 1**: Inventory, Cart, Saga, RBAC (DONE)
- **Phase 2**: Payment, Notification, Review, Promotion, Media (DONE)
- **Phase 3**: Production hardening, observability wiring, API docs (TODO)

## Acceptance Criteria

Mỗi phase phải đạt:
- ✅ Tất cả checklist trong phase file được check
- ✅ Không phụ thuộc AWS
- ✅ Saga/Order flow có idempotency + compensation, verify bằng test
- ✅ Health check + graceful shutdown hoạt động
- ✅ Simulate provider chạy end-to-end (không cần API key thật)
- ✅ Test coverage ≥70% cho code mới

## Kế Tiếp (Next Steps)

1. Phase 3: Production hardening, full observability wiring
2. Back-office UI/Admin dashboard
3. Real payment provider integration (VNPay, MoMo)
4. Real email/push provider (Resend, FCM)
5. Search engine integration (Elasticsearch/OpenSearch)
