# Onboarding Guide — đọc tài liệu thế nào để nắm dự án

**Ngày cập nhật**: 2026-10-15
**Đối tượng**: developer/AI agent mới vào dự án. Mục tiêu: hiểu đủ để sửa code an toàn trong 1–2 giờ đọc, thay vì đọc hết 15 file trong `docs/`.

---

## 1. Bản đồ tài liệu (mỗi file trả lời câu hỏi gì)

| File | Trả lời câu hỏi | Độ sâu | Thời gian |
|---|---|---|---|
| [../README.md](../README.md) | Dự án là gì, chạy thế nào? | Tổng quan | 5' |
| [../CLAUDE.md](../CLAUDE.md) (gốc) | Quy tắc bắt buộc + 14 mục cần nắm (§2.1) | Cô đọng | 5' |
| [project-overview-pdr.md](./project-overview-pdr.md) | Hệ thống phục vụ nghiệp vụ gì, phạm vi, mục tiêu? | Product | 10' |
| [codebase-summary.md](./codebase-summary.md) | Thư mục nào chứa gì, port, stack? | Bản đồ code | 10' |
| [system-architecture.md](./system-architecture.md) | Các service nối với nhau ra sao, observability? | Kiến trúc | 15' |
| [database-schema.md](./database-schema.md) | Bảng nào, quan hệ/FK/index ra sao (ERD Mermaid)? | Dữ liệu | 15' |
| [business-flows.md](./business-flows.md) | Hệ thống **làm gì** end-to-end, rule nghiệp vụ, state machine? | Nghiệp vụ | 25' |
| [module-processing-flows.md](./module-processing-flows.md) | Từng module **xử lý từng bước thế nào**? | Chi tiết code | 30' (tra cứu) |
| [design-trade-offs.md](./design-trade-offs.md) | **Vì sao** thiết kế vậy, được/mất gì, rủi ro nào còn mở? | Quyết định | 20' |
| [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) | Orchestration/Outbox-Inbox Kafka/locking chi tiết, sequence checkout v2 | Deep-dive | 15' |
| [system-architecture-auth-flow.md](./system-architecture-auth-flow.md) | Login, verify token, logout, RBAC | Deep-dive | 10' |
| [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) | Middleware chain, envelope request/response | Deep-dive | 10' |
| [target-checkout-architecture.md](./target-checkout-architecture.md) | **Nguồn thiết kế** checkout v2 (đã chốt: Kafka, Inventory, Shipping, huỷ/hoàn); §10 trạng thái implement và kiểm chứng; §11 câu hỏi mở | Thiết kế + trạng thái | 15' |
| [code-standards.md](./code-standards.md) | Viết code theo quy ước nào? CQRS, TCP/Kafka, test | Quy ước | 15' |
| [load-testing-guide.md](./load-testing-guide.md) | Chạy k6, sizing VPS 4 vCPU/8 GB, đọc dashboard k6 và Infrastructure | Vận hành | 10' |
| [project-roadmap.md](./project-roadmap.md) | Đã làm gì, còn gì, gap nào? | Kế hoạch | 10' |
| `apps/<app>/CLAUDE.md` | Quy tắc + gotcha riêng của 1 service | Cô đọng | 3'/file |

**Nguyên tắc**: tài liệu chia 3 tầng — *cái gì* (business-flows) → *thế nào* (module-processing-flows) → *vì sao* (design-trade-offs). Đọc theo thứ tự đó, đừng nhảy thẳng vào code.

---

## 2. Lộ trình đọc theo mục tiêu

### A. "Tôi mới vào, cần hiểu bức tranh chung" (~1 giờ)
1. `README.md` + `CLAUDE.md` gốc §1–2.1 — nắm stack, 10 service, Kafka, quy tắc.
2. `system-architecture.md` — chỉ sơ đồ + mục *Communication Patterns*.
3. `business-flows.md` §1 (bản đồ) → §2.4 (checkout v2) → §2.5 (state machine đơn) → §2.6 (hoàn tiền).
4. `design-trade-offs.md` §1–2 và §5 (rủi ro) — để biết chỗ nào **đừng tin**.

### B. "Tôi sắp sửa/thêm tính năng trong 1 service"
1. `apps/<service>/CLAUDE.md` (3 phút).
2. Mục tương ứng trong `module-processing-flows.md` (§0.3a Kafka, §1 Gateway … §8 Promotion/Inventory/Shipping).
3. Mục nghiệp vụ liên quan trong `business-flows.md`.
4. `code-standards.md` (cấu trúc CQRS, DTO, error).
5. Mở code theo mục [4](#4-đọc-code-theo-thứ-tự-nào).
6. Trước khi merge: tra `design-trade-offs.md §5` xem thay đổi có đụng rủi ro đã biết không.

### C. "Tôi cần debug 1 lỗi"
1. Xác định lỗi xảy ra ở tầng nào bằng *pipeline Gateway* (`system-architecture-gateway-flow.md §1`): 401 (x-api-key, JWT) → 403 (bitmask) → 429 (throttle) → 400 (ValidationPipe, thiếu `x-idempotency-key`) → 409 (idempotency đang xử lý, hết hàng, lệch version) → 503 (Redis lỗi ở route checkout) → 504 (User timeout) → 502 (breaker mở, lỗi service) / 408 (service timeout).
2. Bảng *mã lỗi* ở `business-flows.md §3` để biết rule nào sinh ra mã đó.
3. Dò theo `x-request-id` (trả trong header + `meta.requestId`) trên Jaeger (`:16686`).
4. Lỗi liên quan đơn hàng: `system-architecture-orders-flow.md` (orchestration, race, gap còn lại) và `module-processing-flows.md §4`. Event không tới: xem bảng `outbox` (`PENDING/FAILED`, cột `source`/`topic`), `processed_messages` và topic `<topic>.dlq`.

### D. "Tôi review kiến trúc / chuẩn bị phỏng vấn / ra quyết định"
1. `design-trade-offs.md` toàn bộ (§7 = câu hỏi đang mở).
2. `system-architecture-orders-flow.md` (orchestration/outbox-inbox/locking) và `target-checkout-architecture.md`.
3. `project-roadmap.md` (gap + decision log).

### E. "Tôi là AI agent bắt đầu 1 task"
Chỉ cần nạp theo thứ tự: `CLAUDE.md` gốc → `apps/<service>/CLAUDE.md` → mục liên quan trong `module-processing-flows.md`. Chỉ mở file sâu hơn khi task chạm checkout/Kafka/auth/gateway. Nhớ quy tắc §4.5: **chưa rõ nghiệp vụ thì hỏi lại**, không đoán.

---

## 3. Cách đọc từng loại tài liệu

- **Nhãn `[ĐÃ CÓ]` / `[CHƯA CÓ]`** (business-flows): phân biệt cái code đang làm với cái "lẽ ra phải có". Đừng giả định `[CHƯA CÓ]` đã tồn tại (ví dụ: refresh token, kiểm tra chủ sở hữu ở `GET /orders*`).
- **Gap/Rủi ro (R1–R20)** (design-trade-offs §5): đây là sự thật đã xác minh với code tại ngày cập nhật, không phải ý tưởng. Khi bạn sửa xong 1 gap, **cập nhật bảng đó** và `project-roadmap.md`.
- **Đường dẫn file trong ngoặc**: luôn là bằng chứng; nếu code đã đổi mà tài liệu lệch → tin code, sửa tài liệu.
- **Sơ đồ ASCII**: chỉ đọc thứ tự bước và ranh giới transaction; chi tiết đúng-sai nằm ở text bên dưới.
- **Ngày cập nhật** đầu mỗi file: sau đợt rà soát 2026-10-15, các file chính đều ghi ngày này. Nếu thấy file nào ghi ngày cũ hơn và mâu thuẫn với code, tin code và sửa file đó.

### Thuật ngữ cần biết trước khi đọc
| Thuật ngữ | Nghĩa trong dự án |
|---|---|
| `{cmd}` pattern | Tên RPC TCP, định nghĩa ở `libs/constant/message-pattern.constant.ts` |
| Orchestration | Orders giữ state machine, ra command (qua Kafka) và đổi trạng thái theo event; Saga đồng bộ cũ đã xoá |
| Outbox / Inbox | `outbox` ghi cùng transaction, `OutboxRelayService` đẩy Kafka at-least-once; `processed_messages` khử trùng theo `(consumer, eventId)` |
| Reserve / commit / release | Inventory giữ hàng có TTL (`reserved`), chỉ trừ thật (`onHand`) khi thanh toán xong; hết hạn/huỷ thì nhả |
| Chốt #1/#2/#3 | 3 lần kiểm tra còn hàng trước khi cho thanh toán (sau tạo đơn, lúc `GET /orders/:id/pay`, hạn intent = hạn reservation) |
| Version lock | `UPDATE orders ... WHERE version` — bên thua race đọc lại state |
| Bitmask `Module\|Action` | Quyền = số nguyên; kiểm tra `(user & required) === required` |
| Snapshot | Giá + địa chỉ được copy vào Order, không đổi theo dữ liệu gốc |
| Simulated provider | Payment/Shipping/Email/Push giả lập mặc định; Payment/Shipping đi đúng đường webhook HMAC (`/simulator/*` ở Gateway) |

---

## 4. Đọc code theo thứ tự nào

Một request xuyên hệ thống — đọc theo chiều đi của nó:

1. **Entry**: `apps/gateway/src/main.ts` → `gateway.module.ts` (guard/interceptor/middleware toàn cục).
2. **Pipeline**: `common/middleware/request-tracker.middleware.ts` → `common/guard/*` → `common/interceptor/*` → `common/tcp-resilience.service.ts`.
3. **Controller/Service của domain** trong `apps/gateway/src/<domain>/`.
4. **Pattern**: `libs/constant/message-pattern.constant.ts` (map HTTP → RPC).
5. **Service đích**: `apps/<service>/src/<service>.controller.ts` → `commands|queries/handlers/` → `entities/`.
6. **Lỗi**: `libs/common/src/filters/base-rpc-exception.filter.ts` → `gateway/common/microservice-error.handler.ts` → `fliters/http-exception.filter.ts` (tên thư mục viết sai `fliters` trong code — giữ nguyên khi import).

**Bài tập khởi động (nên làm 1 lần)**: lần theo `POST /cart/checkout` qua `apps/gateway/src/orders/cart.controller.ts` → `orders.service.ts` → `apps/orders/src/commands/handlers/checkout.handler.ts` (→ `pricing/order-pricing.service.ts`, `clients/inventory.client.ts`) → `apps/inventory/src/domain/reservation.service.ts` → `apps/payment/src/commands/handlers/create-payment-intent.handler.ts`; rồi phần bất đồng bộ: `payment/commands/handlers/handle-payment-webhook.handler.ts` → `libs/messaging/src/outbox/outbox-relay.service.ts` → `apps/orders/src/messaging/payment-events.consumer.ts` → `handle-payment-event.handler.ts` → `order-state/order-transition.service.ts`. Đối chiếu từng bước với `business-flows.md §2.4`.

---

## 5. Chạy thử để kiểm chứng điều vừa đọc

```bash
npm install
npm run docker:up        # postgres, redis, kafka (KRaft), jaeger, prometheus, grafana, minio + exporter postgres/redis/kafka
# tạo .env (bắt buộc: DB_*, REDIS_*, JWT_*, API_KEY, KAFKA_BROKERS=localhost:9092,
#   PAYMENT_WEBHOOK_SECRET, SHIPPING_WEBHOOK_SECRET — danh sách đầy đủ: libs/common/src/utils/env-validation.ts;
#   thiếu một biến thì mọi service không khởi động. Repo không có .env.example)
# BACKUP DB trước khi bật service nếu DB đã có dữ liệu (xem cảnh báo dưới)
npm run start:all        # 9 microservice + gateway (migration tự chạy khi service khởi động)
npm run seed             # dữ liệu lớn, mật khẩu Password123 (scripts/seeded-users.csv)
```

> **Cảnh báo migration**: 7 migration checkout v2 (`1791874600000` … `1791879000000`) chạy tự động và **không thể hoàn nguyên đầy đủ**. `FinalizeOrderStatusAndStockOwnership` xoá cột `stock` của `products` và `product_variants` và đổi enum trạng thái đơn (`PENDING`/`PROCESSING` → `PENDING_PAYMENT`, huỷ ngay). `down` không khôi phục trạng thái đơn. Trên DB có dữ liệu thật: `pg_dump` (custom format) ra ngoài repo trước, rồi mới bật service.
>
> **Seed**: `scripts/seed.ts` ghi thẳng vào DB `ecommerce` (đường dẫn cứng). Chưa chạy lại sau cutover.

- Swagger: `http://localhost:3000/api/docs` · Jaeger `:16686` · Prometheus `:9090` · Grafana `:3100` (admin/admin) · MinIO console `:9001`.
- Dashboard Grafana (thư mục `grafana/dashboards/`): `Ecommerce - Server Overview`, `Ecommerce - Infrastructure` (Overview, Pipeline nghiệp vụ, PostgreSQL, Redis, Kafka), `k6 Load Test`.
- Gateway có thể chạy cổng khác 3000 bằng `GATEWAY_PORT`. Khi đó đặt `PUBLIC_API_BASE_URL` để `payment_url` trỏ đúng cổng (mặc định `http://localhost:3000`).
- Gọi API mẫu: `http/api-tests.http` hoặc `http/ecommerce.postman_collection.json`. **Mọi request cần header `x-api-key`**, route bảo vệ cần `Authorization: Bearer`.
- User mới đăng ký có `permissions=0` — gán role qua `POST /roles/assign` (hoặc dùng user từ seed) trước khi gọi API cần quyền.

> Checkout v2 đã chạy E2E trên stack thật (E-01…E-13, xem `plans/261015-1700-checkout-v2-event-driven/reports/e2e-test-report.md`). Khi gặp lỗi, đối chiếu mục 3 "Bug thật tìm được và đã sửa" trong báo cáo đó (bug đã sửa: webhook eventId không phải UUID, Notification thiếu `Transport.TCP`, breaker mở vì lỗi 4xx). Muốn thấy đơn đi hết luồng nhanh: đặt `PAYMENT_SIM_MODE=auto-success`.

**Thử nghiệm giúp hiểu nhanh**
1. Thêm vài món vào cart → `POST /cart/checkout` (bắt buộc `x-idempotency-key`) → nhận `PENDING_PAYMENT` + `payment_url`; `stock_items.reserved` tăng, cart giữ nguyên.
2. Mở trang `/simulator/pay/:intentId` bấm "Thành công" → đơn đi `PAID → FULFILLING → SHIPPED`; `POST /shipments/:orderId/deliver` → `DELIVERED`.
3. Gửi lại cùng `x-idempotency-key` → nhận lại response cũ (đúng status gốc); thiếu header → 400.
4. Checkout vượt tồn kho → 409 và kho không đổi; huỷ đơn khi `PAID` → `CANCELLED` + hoàn `total − phí ship` + kho cộng lại.

---

## 6. Checklist "đã nắm dự án"

Bạn đủ sẵn sàng khi trả lời được, không cần mở tài liệu:
- [ ] Vì sao Gateway gọi `VERIFY_TOKEN` mỗi request và hệ quả hiệu năng?
- [ ] Checkout v2 gồm mấy bước đồng bộ, bước nào có transaction DB, 3 chốt kiểm tra còn hàng nằm ở đâu?
- [ ] Sau thanh toán đơn đi qua những service/topic nào, ai chuyển `PAID`, `FULFILLING`, `SHIPPED`?
- [ ] Reserve → commit/release hoạt động ra sao; khoá lạc quan trên Order xử lý race huỷ vs `ShipmentCreated` thế nào?
- [ ] Outbox + Inbox đảm bảo điều gì (at-least-once, idempotent) và **không** đảm bảo điều gì (exactly-once)?
- [ ] Khi thanh toán tới muộn vào đơn đã huỷ thì chuyện gì xảy ra?
- [ ] Quyền bitmask kiểm tra thế nào; vì sao user mới chưa gọi được API?
- [ ] Rủi ro bảo mật cao còn lại (R2–R3: thiếu kiểm tra chủ sở hữu) và các rủi ro vận hành mới (R16–R20, gồm F1 mất message khi consumer down)?
- [ ] Service nào dùng CQRS, service nào không, và vì sao?

---

## 7. Giữ tài liệu sống

- Đổi hành vi nghiệp vụ → sửa `business-flows.md` + `module-processing-flows.md` + `CLAUDE.md` của app + (nếu đóng/mở rủi ro) `design-trade-offs.md §5` và `project-roadmap.md`.
- Thêm service/lib → cập nhật `CLAUDE.md` gốc (§2) và `codebase-summary.md`.
- Mỗi file giữ dưới 800 dòng; tách file con nếu vượt.
- Kiểm tra: `node .claude/scripts/validate-docs.cjs docs/` (cảnh báo "code reference/config key" phần lớn là báo nhầm, link nội bộ hỏng mới đáng lo). Lưu ý: khi kiểm tra ngày 2026-10-15 lệnh này đã treo, nên kiểm link tương đối bằng script riêng.
