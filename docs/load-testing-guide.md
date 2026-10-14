# Load test với k6 và sizing VPS

Mục tiêu: 500 user đồng thời trên VPS **2 vCPU / 4 GB**. Stack chạy trong Docker với giới hạn tài nguyên để mô phỏng VPS, k6 chạy trên máy host.

## Thành phần

| File | Vai trò |
|---|---|
| `loadtest/docker-compose.loadtest.yml` | Override compose: giới hạn CPU/RAM, thêm container `apps`, bật remote-write cho Prometheus |
| `loadtest/Dockerfile.apps`, `loadtest/start-apps.sh` | Gộp 8 app NestJS vào 1 container (chia sẻ CPU/RAM như trên 1 VPS) |
| `loadtest/k6/load-test.js` | Kịch bản k6 (profile `mixed`, `read`, `cart`, `checkout`, `auth`) |
| `loadtest/collect-docker-stats.sh` | Ghi CPU/RAM từng container ra CSV |
| `grafana/dashboards/k6-load-test.json` | Dashboard k6 (VUs, RPS, lỗi, p95) |

Phân bổ quota (tổng 2 CPU / 4 GB, đổi bằng biến `LT_*`): apps 0.8 CPU / 2.5 GB, postgres 1.0 CPU / 1 GB, redis 0.2 CPU / 0.5 GB. Prometheus, Grafana, Jaeger không tính vào quota (trên VPS thật nên chạy ở máy khác).

## Chạy

```bash
# 1. Chỉ cần Docker, không cần cài k6
# 2. Dựng stack có giới hạn tài nguyên (lần đầu build image rất lâu)
npm run loadtest:up

# 3. Seed dữ liệu vào Postgres của stack (cần apps đã chạy xong để migration tạo bảng)
npm run seed

# 4. Thu CPU/RAM container (terminal riêng)
sh loadtest/collect-docker-stats.sh

# 5. Chạy k6 bằng Docker (không cần cài k6), metric tự đẩy vào Prometheus -> Grafana http://localhost:3100, dashboard "k6 Load Test"
npm run loadtest:run
```

Chỉnh tải bằng biến môi trường: `PROFILE=read|cart|checkout|auth|mixed`, `TARGET_VUS`, `RAMP`, `HOLD`. Thử ít user trước:

```bash
TARGET_VUS=50 RAMP=1m HOLD=1m npm run loadtest:run          # bash
$env:TARGET_VUS=50; $env:RAMP="1m"; $env:HOLD="1m"; npm run loadtest:run   # PowerShell
```

k6 chạy ngoài quota 2 CPU / 4 GB của VPS (tốn CPU của máy host, không ảnh hưởng container `apps`).

## Throttle

Gateway giới hạn theo IP, k6 chạy từ 1 IP nên compose đặt `THROTTLE_LIMIT_DEFAULT` và `THROTTLE_LOGIN_LIMIT` rất cao. `THROTTLE_LOGIN_LIMIT` (mặc định 5/phút) áp cho `POST /user/login` và `POST /user/register`. Không dùng các giá trị này ở production.

## Đọc kết quả để chọn VPS

SLO trong `thresholds` của kịch bản: lỗi server < 1% (5xx, timeout, 429), p95 login < 1.5s, browse < 500ms, cart < 800ms, checkout < 2s.

1. Xem tải tại thời điểm p95 bắt đầu vượt SLO hoặc lỗi tăng: đó là điểm bão hòa (VUs, RPS).
2. Từ CSV docker stats, lấy CPU% và RAM của `apps`, `postgres`, `redis` ở mức tải đỉnh. Container giới hạn 0.8 CPU hiển thị tối đa 80%; chạm trần mà latency tăng nghĩa là thiếu CPU.
3. Quy đổi:
   - Đạt SLO ở 500 user với CPU dưới ~70% quota: 2 vCPU / 4 GB đủ, có dư địa.
   - Đạt SLO nhưng CPU gần trần: 2 vCPU đủ ở mức 500 nhưng không có dự phòng; nên lên 4 vCPU cho đỉnh tải.
   - Không đạt: xem container nào chạm trần. Thiếu CPU `apps` thì tăng vCPU; RAM `apps` gần 2.5 GB thì tăng RAM; Postgres chạm trần thì tách DB hoặc thêm index/cache.
4. Giữ dự phòng 30–40% so với mức đạt SLO khi chốt cấu hình.

## Hạn chế của số đo

- Payment là `SimulatedPaymentProvider` (luôn success, tức thì): số đo checkout chưa gồm độ trễ cổng thanh toán thật.
- Hầu hết đo qua Docker Desktop (WSL2): CPU mỗi core có thể khác VPS, nên xem kết quả là tương đối. Nên chạy lại một lần trên VPS thật trước khi chốt.
- Trace OTLP gửi tới `localhost:4318` bên trong container `apps` (không có Jaeger ở đó), nên chi phí tracing không giống khi Jaeger chạy thật.
- Checkout trừ kho thật: stock seed hết dần khiến checkout bị từ chối (đếm ở `lt_checkout_rejected`, không tính là lỗi server). Seed lại DB giữa các lần chạy để so sánh công bằng.
- Mỗi VU dùng cố định 1 user trong `scripts/seeded-users.csv` (2000 user), nên 500 VU không đụng nhau về cart.
