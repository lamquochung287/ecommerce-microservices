# Hướng dẫn cho AI Agents - User & Auth Module

## Vai trò
Microservice TCP :3001: User, xác thực JWT, RBAC (Role), Address book. **Không dùng CQRS** (service/controller trực tiếp — chủ ý, nghiệp vụ nhỏ).
Chi tiết: [docs/module-processing-flows.md §2](../../docs/module-processing-flows.md), [docs/system-architecture-auth-flow.md](../../docs/system-architecture-auth-flow.md).

## Pattern (`libs/constant/message-pattern.constant.ts`)
`REGISTER_USER`, `LOGIN_USER`, `LOGOUT_USER`, `VERIFY_TOKEN`, `UPDATE_AVATAR`, `get_user_info` (qua `CMD` cũ ở `libs/common/.../cmd.ts`, Notification dùng), `ADDRESS_*`, `ROLE_*`.

## Luồng cốt lõi
- **register**: email trùng → 409; `bcrypt.hash(10)`; user mới `permissions=0`, **không tự gán role**.
- **login**: sai email/mật khẩu cùng 1 lỗi 401; `sessionId=uuid`; access (`JWT_ACCESS_SECRET`, 15m) + refresh (`JWT_REFRESH_SECRET`, 7d), payload `{sub,email,sessionId}`; Redis `refresh_token:{userId}:{sessionId}` TTL cố định 7 ngày.
- **verify_token** (Gateway gọi mỗi request): verify access → Redis còn session? → user tồn tại & `isActive` → `permissions` = OR bitmask các Role (null nếu chưa có role → fallback cột `User.permissions`). Mọi lỗi gom thành 401 "Invalid or expired token".
- **logout**: `DEL refresh_token:{userId}:{sessionId}` → access token vô hiệu ngay.
- **Không có refresh endpoint**: access hết hạn = login lại.

## Quy tắc
- Mật khẩu luôn bcrypt; không log/trả mật khẩu. Không lưu access token vào DB. Revoke = xoá key Redis (`libs/cached`).
- `userId` (uuid) là định danh công khai dùng ở mọi service; `id` (serial) chỉ cho quan hệ nội bộ (UserRole/Address). Đừng trả `id` serial ra ngoài.
- Quyền bitmask: `libs/constant/permission.constant.ts` (Action 1/2/4/8, Module từ 16). Thêm module mới = thêm bit mới, không đổi bit cũ.
- Địa chỉ default: đổi default luôn trong transaction (bỏ default cũ).

## Gotchas
- Address `update/delete/setDefault` theo `id` không kiểm tra chủ sở hữu ở service (cần truyền/so `userId`).
- Mỗi request có auth tốn 1 TCP + Redis + 1–2 query DB → đây là điểm nghẽn; tránh thêm query nặng vào `verifyToken`.
- Fallback secret `'access_secret'/'refresh_secret'` trong code chỉ vô hại nhờ `validateEnv`; không dựa vào nó.
