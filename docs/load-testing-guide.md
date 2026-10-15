# Load test với k6 và sizing VPS

Mục tiêu: 500 user đồng thời trên VPS **4 vCPU / 8 GB** chạy cả Kafka. Stack chạy trong Docker với giới hạn tài nguyên để mô phỏng VPS, k6 chạy trên máy host.

## Thành phần

| File | Vai trò |
|---|---|
| `loadtest/docker-compose.loadtest.yml` | Override compose: giới hạn CPU/RAM, thêm container `apps`, bật remote-write cho Prometheus |
| `loadtest/Dockerfile.apps`, `loadtest/start-apps.sh` | Gộp 10 app NestJS (kể cả `inventory`, `shipping`) vào 1 container (chia sẻ CPU/RAM như trên 1 VPS) |
| `loadtest/k6/load-test.js` | Kịch bản k6 (profile `mixed`, `read`, `cart`, `checkout`, `auth`) |
| `loadtest/collect-docker-stats.sh` | Ghi CPU/RAM từng container ra CSV |
| `grafana/dashboards/k6-load-test.json` | Dashboard k6 (VUs, RPS, lỗi, p95) |
| `grafana/dashboards/ecommerce-infrastructure.json` | Dashboard PostgreSQL/Redis/Kafka + pipeline nghiệp vụ; xem CPU, kết nối DB, lag consumer, DLQ trong lúc chạy tải |

Container `apps` cần Kafka (service `kafka` của `docker-compose.yml`, `KAFKA_BROKERS=kafka:29092`) cùng `PAYMENT_WEBHOOK_SECRET`, `SHIPPING_WEBHOOK_SECRET` (đã đặt trong `docker-compose.loadtest.yml`). Image chạy `NODE_ENV=production` làm simulator bị tắt (không đơn nào thanh toán được), nên compose loadtest đặt `NODE_ENV=development`; biến này chỉ được các simulator đọc. `PAYMENT_SIM_MODE` mặc định `manual` (k6 tự thanh toán qua `/simulator/pay`), đổi bằng `LT_PAYMENT_SIM_MODE=auto-success` nếu muốn Payment tự thanh toán sau `LT_PAYMENT_SIM_DELAY_MS`. Shipping tự "đã giao" sau `LT_SHIPPING_DELIVER_DELAY_MS` (mặc định 5000ms, `0` = tắt), hạn thanh toán/giữ hàng đặt bằng `LT_ORDER_PAYMENT_TTL_SECONDS` (mặc định 900).

Phân bổ quota (tổng 4 CPU / 8 GB, đổi bằng biến `LT_*`): apps 1.8 CPU / 4 GB, postgres 1.0 CPU / 1 GB, redis 0.2 CPU / 1 GB, kafka 1.0 CPU / 2 GB (`LT_KAFKA_CPUS`, `LT_KAFKA_MEM`). Prometheus, Grafana, Jaeger và các exporter không tính vào quota (trên VPS thật nên chạy ở máy khác).

## Chạy

```bash
# 1. Chỉ cần Docker, không cần cài k6
# 2. Dựng stack có giới hạn tài nguyên (lần đầu build image rất lâu)
npm run loadtest:up

# 3. Seed dữ liệu vào Postgres của stack (bảng do service `migrate` của compose tạo trước khi apps chạy;
#    seed.ts đang trỏ cứng DB `ecommerce`, khớp với DB của stack)
npm run seed

# 4. Thu CPU/RAM container (terminal riêng)
sh loadtest/collect-docker-stats.sh

# 5. Chạy k6 bằng Docker (không cần cài k6), metric tự đẩy vào Prometheus -> Grafana http://localhost:3100, dashboard "k6 Load Test"
npm run loadtest:run
```

Chỉnh tải bằng biến môi trường: `PROFILE=read|cart|checkout|auth|mixed`, `TARGET_VUS`, `RAMP`, `HOLD`; với checkout thêm `PAY_RATIO` (tỉ lệ đơn được thanh toán, mặc định 0.7) và `CANCEL_RATIO` (tỉ lệ đơn đã thanh toán bị huỷ, mặc định 0.1). Thử ít user trước:

```bash
TARGET_VUS=50 RAMP=1m HOLD=1m npm run loadtest:run          # bash
$env:TARGET_VUS=50; $env:RAMP="1m"; $env:HOLD="1m"; npm run loadtest:run   # PowerShell
```

k6 chạy ngoài quota 4 CPU / 8 GB của VPS (tốn CPU của máy host, không ảnh hưởng container `apps`).

## Throttle

Gateway giới hạn theo IP, k6 chạy từ 1 IP nên compose đặt `THROTTLE_LIMIT_DEFAULT` và `THROTTLE_LOGIN_LIMIT` rất cao. `THROTTLE_LOGIN_LIMIT` (mặc định 5/phút) áp cho `POST /user/login` và `POST /user/register`. Không dùng các giá trị này ở production.

## Đọc kết quả để chọn VPS

SLO trong `thresholds` của kịch bản: lỗi server < 1% (5xx, timeout, 429), p95 login < 1.5s, browse < 500ms, cart < 800ms, checkout < 2s.

1. Xem tải tại thời điểm p95 bắt đầu vượt SLO hoặc lỗi tăng: đó là điểm bão hòa (VUs, RPS).
2. Từ CSV docker stats, lấy CPU% và RAM của `apps`, `postgres`, `redis`, `kafka` ở mức tải đỉnh. Container giới hạn 1.8 CPU hiển thị tối đa 180%; chạm trần mà latency tăng nghĩa là thiếu CPU.
3. Quy đổi:
   - Đạt SLO ở 500 user với CPU dưới ~70% quota: 4 vCPU / 8 GB đủ, có dư địa.
   - Đạt SLO nhưng CPU gần trần: 4 vCPU đủ ở mức 500 nhưng không có dự phòng; nên lên 6–8 vCPU cho đỉnh tải.
   - Không đạt: xem container nào chạm trần. Thiếu CPU `apps` thì tăng vCPU; RAM `apps` gần 4 GB thì tăng RAM; Postgres chạm trần thì tách DB hoặc thêm index/cache; Kafka chạm trần (lag consumer tăng) thì tăng CPU/RAM broker.
4. Giữ dự phòng 30–40% so với mức đạt SLO khi chốt cấu hình.

## Hạn chế của số đo

- Payment/Shipping là simulator (không có độ trễ cổng/carrier thật). Kịch bản `checkout` chạy: `POST /cart/checkout` (body `{items:[{productId}], shippingAddress}`, header `x-idempotency-key` mới mỗi lần) → với `PAY_RATIO` đơn: `GET /orders/:id/pay` (chốt còn hàng) → `POST /simulator/pay/:intentId/success` → với `CANCEL_RATIO` đơn: `POST /orders/:id/cancel`. Các đơn bỏ dở tự hết hạn sau `ORDER_PAYMENT_TTL_SECONDS` và trả kho; các đơn đã thanh toán đi tiếp pha bất đồng bộ qua Kafka (PAID → FULFILLING → SHIPPED → DELIVERED nhờ timer giao hàng). Metric thêm: `lt_pay_link_duration`, `lt_pay_duration`, `lt_cancel_duration`, `lt_order_paid`, `lt_order_cancelled`, `lt_pay_unavailable` (khác 0 nghĩa là simulator đang bị tắt: kiểm `NODE_ENV`/`PAYMENT_SIM_MODE`). k6 chưa poll trạng thái đơn nên thời gian tới `DELIVERED` chỉ quan sát được qua DB hoặc Grafana của các service, không có trong số đo k6. Chưa kiểm chứng kịch bản này trên stack thật.
- Hầu hết đo qua Docker Desktop (WSL2): CPU mỗi core có thể khác VPS, nên xem kết quả là tương đối. Nên chạy lại một lần trên VPS thật trước khi chốt.
- Trace OTLP gửi tới `localhost:4318` bên trong container `apps` (không có Jaeger ở đó), nên chi phí tracing không giống khi Jaeger chạy thật.
- Checkout **giữ** kho (reserve, TTL 15'): `onHand` seed không giảm nhưng `reserved` tăng; sản phẩm hết hàng bị từ chối 409 (đếm ở `lt_checkout_rejected`, không tính là lỗi server). Checkout lặp trên cùng sản phẩm của cùng user thay thế đơn cũ (`replaces`). Seed lại DB giữa các lần chạy để so sánh công bằng.
- **Chưa có số đo k6 sau cutover**: kịch bản và compose đã được sửa mã, chưa có output k6 chính thức trong repo. Thư mục `loadtest/results/` có `docker-stats-500vu.csv` và `docker-stats-500vu-split.csv` (CPU/RAM, ghi từ 14:16 đến 20:59 ngày 2026-10-15, đang được ghi khi kiểm tra). Chưa xác nhận đây là lần chạy k6 sau cutover; chỉ coi là số đo khi có k6 summary đi kèm và đã đối chiếu.
- Mỗi VU dùng cố định 1 user trong `scripts/seeded-users.csv` (2000 user), nên 500 VU không đụng nhau về cart.
