# System Architecture — Authentication & Authorization Flow

**Ngày cập nhật**: 2026-10-05

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả chi tiết flow đăng nhập, xác thực JWT trên mỗi request, refresh token, và đăng xuất.

---

## JWT Token Management

### 1. User Login Flow

```
┌────────────────────────────────────────────────────┐
│           User Login Flow                          │
├────────────────────────────────────────────────────┤
│                                                    │
│ 1. POST /user/login                               │
│    Body: { email, password }                      │
│                                                    │
│ 2. USER SERVICE                                   │
│    ├─ Hash password + so sánh với hash đã lưu     │
│    ├─ Tạo accessToken (15 phút, có ký)            │
│    ├─ Tạo refreshToken (7 ngày, có ký)            │
│    ├─ sessionId = crypto.randomUUID()             │
│    ├─ Lưu: REDIS key refresh_token:{userId}:{sessionId} = token │
│    └─ Trả về: { accessToken, refreshToken, sessionId } │
│                                                    │
│ 3. GATEWAY (TransformInterceptor)                 │
│    └─ Bọc: { success: true, data: {...} }         │
│                                                    │
│ 4. CLIENT (Browser)                              │
│    ├─ Lưu accessToken trong memory (hoặc cookie)  │
│    └─ Lưu refreshToken (secure, http-only)        │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 2. Xác thực mỗi Request

```
┌────────────────────────────────────────────────────┐
│      Per-Request Auth Verification                │
├────────────────────────────────────────────────────┤
│                                                    │
│ 1. Client gửi GET /products                        │
│    Headers: Authorization: Bearer {accessToken}   │
│                                                    │
│ 2. GATEWAY (JwtAuthGuard)                         │
│    ├─ Lấy token từ header                          │
│    ├─ Decode JWT (verify signature + expiry)      │
│    ├─ Nếu invalid/expired → 401 Unauthorized      │
│    ├─ Nếu valid → gọi USER_SERVICE.VERIFY_TOKEN   │
│    │             (timeout 5s, qua TCP)             │
│    ├─ USER SERVICE verify:                        │
│    │  - JWT signature đúng                        │
│    │  - refreshToken vẫn còn trong Redis (chưa logout) │
│    │  - user.isActive = true                      │
│    │  - Tính permissions của user (bitwise-OR     │
│    │    tất cả role được gán)                     │
│    └─ Trả về: { userId, email, permissions }      │
│                                                    │
│ 3. GATEWAY (PermissionGuard, nếu có @RequirePermission) │
│    ├─ Check: (user.permissions & required) === required │
│    └─ Nếu fail → 403 Forbidden                     │
│                                                    │
│ 4. Đi tiếp vào controller/service                  │
│    (req.user chứa token đã decode + permissions)   │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 3. Refresh Token (phía Client)

```
┌────────────────────────────────────────────────────┐
│      Token Refresh (Client-side)                   │
├────────────────────────────────────────────────────┤
│                                                    │
│ 1. AccessToken hết hạn (15 phút)                  │
│                                                    │
│ 2. Client phát hiện 401 → gọi POST /user/refresh  │
│    Body: { refreshToken }                         │
│                                                    │
│ 3. USER SERVICE                                   │
│    ├─ Decode refreshToken (verify signature)      │
│    ├─ Lấy: { userId, sessionId }                  │
│    ├─ Check Redis: refresh_token:{userId}:{sessionId} │
│    ├─ Nếu hết hạn hoặc đã xoá → 401 (cần login lại) │
│    ├─ Nếu valid → tạo accessToken MỚI             │
│    └─ Trả về: { accessToken, refreshToken }       │
│                                                    │
│ 4. Client lưu token mới                            │
│                                                    │
└────────────────────────────────────────────────────┘
```

> **Xác nhận (2026-10-05)**: Gateway và `UserController` **không có** endpoint/pattern refresh — chỉ có `REGISTER_USER`, `LOGIN_USER`, `LOGOUT_USER`, `VERIFY_TOKEN`, `GET_USER_INFO`, `UPDATE_AVATAR`. Hết hạn access token (15 phút) = phải login lại. Cũng lưu ý logout hiện nhận `userId/sessionId` từ body, không từ JWT (xem [design-trade-offs.md §5-R4](./design-trade-offs.md#5-rủi-ro--gap-đã-xác-minh-trong-code)). Ghi chú cũ bên dưới giữ lại để tham khảo: trong code hiện tại của `UserController`, **chưa tìm thấy** message pattern riêng cho "refresh access token" — chỉ có `LOGIN_USER`, `LOGOUT_USER`, `VERIFY_TOKEN`. Sơ đồ refresh ở trên mô tả flow *dự kiến* theo thiết kế 2-token (access+refresh), nhưng cần xác nhận thêm việc renew access token phía client hiện đang gọi endpoint nào. Xem [project-roadmap.md](./project-roadmap.md) mục gap liên quan.

### 4. Logout Flow

```
┌────────────────────────────────────────────────────┐
│      Logout Flow                                   │
├────────────────────────────────────────────────────┤
│                                                    │
│ 1. POST /user/logout  (Gateway KHÔNG có guard)    │
│    Body: { userId, sessionId }  (client tự gửi)   │
│                                                    │
│ 2. USER SERVICE (LOGOUT_USER)                     │
│    ├─ Nhận { userId, sessionId } từ body          │
│    ├─ Xoá: refresh_token:{userId}:{sessionId}     │
│    └─ Trả về: { success: true }                   │
│                                                    │
│ 3. CLIENT                                         │
│    ├─ Xoá accessToken khỏi memory                  │
│    ├─ Xoá refreshToken khỏi storage                │
│    └─ Redirect về trang login                      │
│                                                    │
│ Lưu ý: AccessToken không thể revoke trực tiếp     │
│       (stateless) nhưng trở nên vô dụng sau logout: │
│       - Không thể refresh nữa (token đã bị xoá)    │
│       - Sẽ tự hết hạn sau 15 phút                  │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## Permission Model (RBAC bitmask)

- `Role.permissions` và `User.permissions` (legacy fallback) là kiểu `bigint`, lưu dưới dạng bitmask.
- `Action` enum chiếm **bit 0-3**: `NONE=0 / CREATE=1 / UPDATE... ` cụ thể `CREATE=1, READ=2, UPDATE=4, DELETE=8, ALL=15`.
- `ModuleName` enum bắt đầu từ **bit 4 trở lên** (`USER=16, PRODUCT=32, ORDER=64, CAMPAIGN=128, PAYMENT=256, REVIEW=512, PROMOTION=1024`) — **cố ý không đè lên vùng bit của `Action`**, để có thể kết hợp bằng OR thường (`ModuleName.PRODUCT | Action.READ`) mà không cần shift thêm. Đây là chi tiết thiết kế đáng nói tới khi phỏng vấn: tách 2 "trục" permission (module nào + hành động gì) thành 2 dải bit riêng biệt trong cùng 1 số nguyên, giúp check quyền chỉ bằng 1 phép AND thay vì so sánh nhiều cột.
- Khi user có nhiều role: permissions hiệu lực = OR tất cả các role được gán (`RoleService.resolvePermissions`).
- Nếu user chưa được gán role nào: fallback về field `User.permissions` cũ (tương thích ngược).
- `PermissionGuard` (Gateway) kiểm tra: `(user.permissions & requiredPermission) === requiredPermission`, với `requiredPermission = module | action` (decorator `@RequirePermission(module, action)` — tham số **module trước, action sau**).
- Chi tiết đầy đủ + ví dụ code: [code-standards.md](./code-standards.md#permission-model).

---

## Tài liệu liên quan

- [system-architecture.md](./system-architecture.md) — Tổng quan kiến trúc
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md) — Middleware chain của Gateway (bao gồm JwtAuthGuard, PermissionGuard trong pipeline)
- [system-architecture-orders-flow.md](./system-architecture-orders-flow.md) — Orchestration checkout v2, Outbox/Inbox
- [code-standards.md](./code-standards.md) — Quy ước bảo mật (bcrypt, JWT, HMAC, idempotency)
