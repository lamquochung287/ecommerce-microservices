# System Architecture — Authentication & Authorization Flow

**Ngày cập nhật**: 2026-10-15

Tài liệu con của [system-architecture.md](./system-architecture.md). Mô tả đăng nhập, xác thực JWT trên mỗi request, đăng xuất và phân quyền bitmask theo code hiện tại (`apps/user/src/user.service.ts`, `apps/gateway/src/common/guard/`).

---

## 1. Tổng quan

- **Access token**: JWT, 15 phút (`JWT_ACCESS_EXPIRATION`), ký bằng `JWT_ACCESS_SECRET`. Không lưu DB.
- **Refresh token**: JWT, 7 ngày (`JWT_REFRESH_EXPIRATION`), ký bằng `JWT_REFRESH_SECRET`. Được lưu trong Redis và làm **khoá session**. Không dùng để lấy access token mới.
- **Session**: Redis key `refresh_token:{userId}:{sessionId}`, TTL cố định 7 ngày trong code.
- **Permissions** không nằm trong JWT. Tính lại mỗi request, nên thu hồi quyền có hiệu lực ngay.
- **Không có endpoint refresh.** Access token hết hạn sau 15 phút thì phải login lại.

Payload của cả hai token: `{ sub: userId, email, sessionId }`.

---

## 2. Đăng nhập

```
Client ── POST /user/login { email, password } ──▶ Gateway (throttle 5/phút/IP, không JWT)
  └─ TCP LOGIN_USER ──▶ User.login
       1. findOne theo email; không có → 401 "Invalid credentials"
       2. bcrypt.compare; sai → 401 "Invalid credentials" (cùng message, không lộ email tồn tại)
       3. sessionId = crypto.randomUUID()
       4. ký accessToken (JWT_ACCESS_SECRET) và refreshToken (JWT_REFRESH_SECRET)
       5. Redis SET refresh_token:{userId}:{sessionId} = refreshToken, TTL 7 ngày
       6. trả { accessToken, refreshToken, sessionId, user: { id, email, fullName } }
```

- `id` trả ra là `userId` (uuid), không phải `id` serial nội bộ.
- Đăng ký: `POST /user/register` (throttle 5/phút). Email trùng → 409. Mật khẩu băm bcrypt (rounds 10). User mới có `permissions = 0` và **không** được gán role, nên phải gán role qua `POST /roles/assign` trước khi gọi API cần quyền.

---

## 3. Xác thực mỗi request

```
Client ── GET /products (Authorization: Bearer <accessToken>) ──▶ Gateway
  │
  ├─ RequestTrackerMiddleware: x-api-key đúng (xem gateway-flow §2)
  ├─ ThrottlerGuard (toàn cục)
  ├─ JwtAuthGuard
  │     ├─ không có Bearer → 401 "Access token is missing"
  │     └─ TCP VERIFY_TOKEN (timeout 5 giây, KHÔNG qua circuit breaker) ──▶ User.verifyToken
  │            1. jwt.verifyAsync(token, JWT_ACCESS_SECRET): chữ ký và hạn
  │            2. Redis GET refresh_token:{sub}:{sessionId}; không có → "Session revoked or expired"
  │            3. findOne(userId); không có hoặc !isActive → "User not found or inactive"
  │            4. permissions = resolvePermissions(user) (OR bitmask mọi role)
  │            Mọi lỗi được gom thành 401 "Invalid or expired token".
  │     └─ gắn req.user = { userId, email, fullName, permissions, sessionId }
  │     └─ User timeout → 504 "User service timeout"
  ├─ PermissionGuard (nếu có @RequirePermission): (permissions & required) === required, không đủ → 403
  └─ Controller / handler
```

Hệ quả:
- **Mỗi request có xác thực** tốn 1 TCP tới User, 1 lần Redis và 1–2 truy vấn DB. Đây là điểm nghẽn tiềm năng (xem [design-trade-offs.md §1.2](./design-trade-offs.md)).
- Đăng xuất hoặc khoá user có hiệu lực ở request kế tiếp, vì Redis key bị xoá hoặc `isActive` = false.

---

## 4. Đăng xuất

```
Client ── POST /user/logout { userId, sessionId } ──▶ Gateway (KHÔNG có guard)
  └─ TCP LOGOUT_USER ──▶ User.logout: Redis DEL refresh_token:{userId}:{sessionId}
```

- Đăng xuất **không** cần JWT. Gateway chuyển `userId`/`sessionId` lấy từ body. Ai biết cặp này có thể đăng xuất session đó. Đây là rủi ro R4 trong [design-trade-offs.md §5](./design-trade-offs.md).
- Access token còn hạn trên lý thuyết, nhưng `VERIFY_TOKEN` sẽ thất bại vì session key đã mất.
- Mỗi session là độc lập: logout một thiết bị không ảnh hưởng session khác của cùng user.

---

## 5. Refresh token

Không có endpoint hay message pattern nào để đổi refresh token lấy access token mới. Refresh token hiện chỉ đóng vai trò khoá session trong Redis. Khi access token hết hạn, client gọi lại `POST /user/login`.

Nếu thêm refresh endpoint sau này, cần: xác thực refresh token (chữ ký `JWT_REFRESH_SECRET`), kiểm tra key Redis còn tồn tại, rồi ký access token mới với cùng `sessionId`. Đây là việc chưa làm, xem [project-roadmap.md](./project-roadmap.md).

---

## 6. Phân quyền (RBAC bitmask)

- `Role.permissions` và `User.permissions` (cột cũ, fallback) là `bigint` dạng bitmask.
- `Action`: `CREATE=1, READ=2, UPDATE=4, DELETE=8, ALL=15` (bit 0–3).
- `ModuleName`: `USER=16, PRODUCT=32, ORDER=64, CAMPAIGN=128, PAYMENT=256, REVIEW=512, PROMOTION=1024` (bit 4 trở lên). Hai dải không chồng nhau nên `ModuleName.PRODUCT | Action.READ` là một số hợp lệ.
- Permissions hiệu lực = **OR** mọi role được gán (`RoleService.resolvePermissions`). Không có role nào thì dùng `User.permissions` (mặc định 0).
- `PermissionGuard`: `(user.permissions & required) === required`, với `required = module | action`. Decorator: `@RequirePermission(module, action)`.
- Bitmask chỉ kiểm tra **module + hành động**, không kiểm tra **chủ sở hữu**. Route theo người dùng phải lấy `userId` từ token và để service so khớp. Chi tiết và các route còn thiếu kiểm tra: [design-trade-offs.md §4–5](./design-trade-offs.md).

Chi tiết và ví dụ code: [code-standards.md §9](./code-standards.md#permission-model).

---

## 7. Tài liệu liên quan

- [system-architecture.md](./system-architecture.md): tổng quan kiến trúc
- [system-architecture-gateway-flow.md](./system-architecture-gateway-flow.md): pipeline Gateway (middleware, guard, interceptor, pipe, filter)
- [module-processing-flows.md](./module-processing-flows.md) §2: chi tiết User service
- [code-standards.md](./code-standards.md) §8: quy ước bảo mật (bcrypt, JWT, HMAC, idempotency)
