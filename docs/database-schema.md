# Database Schema — Relational Diagram (Mermaid)

**Ngày cập nhật**: 2026-10-05
**Nguồn**: entity TypeORM trong `apps/*/src/entities/` đối chiếu migration `libs/database/src/migrations/`. DB: PostgreSQL 15, database `ecommerce`, `synchronize:false`, migration chạy khi service khởi động.

> **Ghi chú đọc sơ đồ**
> - Toàn bộ service dùng **chung 1 database**, nhưng mỗi bảng thuộc về **1 service sở hữu** (mục 1). Quan hệ giữa các service là **tham chiếu mềm bằng UUID** (không có FOREIGN KEY) — vẽ bằng nét đứt (`..`) ở sơ đồ tổng thể.
> - Đường nét liền (`--`) = FK thật trong DB.
> - Tên cột giữ nguyên camelCase như trong DB (`"createdAt"`), riêng cột FK dùng snake_case (`user_id`, `order_id`…).
> - Các bảng `users`, `products`, `orders`, `order_items`, `categories` được tạo từ giai đoạn đầu (synchronize); các migration sau chỉ `ALTER` thêm cột — cột/kiểu dưới đây là trạng thái **hiện tại theo entity**.

---

## 1. Bảng thuộc service nào

| Service | Bảng |
|---|---|
| user | `users`, `roles`, `user_roles`, `addresses` |
| product | `categories`, `brands`, `products`, `attributes`, `attribute_values`, `product_variants`, `product_variant_attribute_values` |
| orders | `orders`, `order_items`, `refunds`, `outbox` |
| payment | `payment_transactions`, `payment_webhook_logs` |
| notification | `sent_notifications` |
| review | `reviews` |
| promotion | `vouchers` |
| (Redis, không phải SQL) | `cart:{userId}`, `refresh_token:{userId}:{sessionId}`, `idempotency:{key}`, throttle counters |

---

## 2. Sơ đồ tổng thể theo service (cross-service = tham chiếu mềm)

```mermaid
flowchart LR
  subgraph USER["user service"]
    users[(users)]
    roles[(roles)]
    user_roles[(user_roles)]
    addresses[(addresses)]
  end
  subgraph PRODUCT["product service"]
    products[(products)]
    product_variants[(product_variants)]
    categories[(categories)]
    brands[(brands)]
  end
  subgraph ORDERS["orders service"]
    orders[(orders)]
    order_items[(order_items)]
    refunds[(refunds)]
    outbox[(outbox)]
  end
  subgraph PAYMENT["payment service"]
    payment_transactions[(payment_transactions)]
    payment_webhook_logs[(payment_webhook_logs)]
  end
  subgraph NOTI["notification service"]
    sent_notifications[(sent_notifications)]
  end
  subgraph REVIEW["review service"]
    reviews[(reviews)]
  end
  subgraph PROMO["promotion service"]
    vouchers[(vouchers)]
  end

  %% FK thật (nội bộ service)
  user_roles --> users
  user_roles --> roles
  addresses --> users
  products --> categories
  products --> brands
  product_variants --> products
  orders --- order_items
  orders --- refunds

  %% Tham chiếu mềm (không FK) giữa các service
  orders -. "userId" .-> users
  order_items -. "productId" .-> products
  reviews -. "userId" .-> users
  reviews -. "productId" .-> products
  reviews -. "orderId" .-> orders
  payment_transactions -. "orderId" .-> orders
  payment_webhook_logs -. "orderId" .-> orders
  sent_notifications -. "recipient (email/userId)" .-> users
  outbox -. "payload.orderId" .-> orders
```

> `vouchers` hiện **không** liên kết với bảng nào (voucher chưa nối vào checkout; `orders` không có cột voucher/discount).
> `product_variants` **không** được tham chiếu bởi `order_items` (đơn hàng tham chiếu `productId`, chưa có `variantId`).

---

## 3. ERD chi tiết — User service

```mermaid
erDiagram
  users ||--o{ user_roles : "có nhiều"
  roles ||--o{ user_roles : "gán cho nhiều"
  users ||--o{ addresses : "sổ địa chỉ"

  users {
    int id PK "serial, khoá nội bộ (index)"
    uuid userId UK "định danh công khai, @Generated uuid"
    varchar email UK
    varchar password "bcrypt hash"
    varchar fullName "nullable"
    varchar avatarUrl "nullable, object path MinIO"
    bigint permissions "bitmask (fallback khi chưa có role), default 0"
    boolean isActive "default true"
    timestamp createdAt
    timestamp updatedAt
    timestamp deletedAt "soft delete, nullable"
  }
  roles {
    uuid id PK
    varchar name UK
    bigint permissions "bitmask Module|Action, default 0"
    timestamp createdAt
    timestamp updatedAt
  }
  user_roles {
    uuid id PK
    int user_id FK "-> users.id, ON DELETE CASCADE"
    uuid role_id FK "-> roles.id, ON DELETE CASCADE"
    timestamp createdAt
  }
  addresses {
    uuid id PK
    int user_id FK "-> users.id, ON DELETE CASCADE"
    varchar recipientName
    varchar recipientPhone
    varchar addressLine1
    varchar addressLine2 "nullable"
    varchar city
    varchar province "nullable"
    varchar postalCode "nullable"
    varchar country
    boolean isDefault "default false"
    timestamp createdAt
    timestamp updatedAt
  }
```

**Ràng buộc/quy tắc**
- `user_roles`: `UNIQUE(user_id, role_id)`.
- Quyền hiệu lực = `OR` mọi `roles.permissions` của user; nếu user không có role nào thì dùng `users.permissions`.
- `users.id` (serial) chỉ dùng cho FK nội bộ; **các service khác dùng `users.userId` (uuid)**. Chú ý: `orders.userId`, `reviews.userId` trỏ tới `users."userId"`, không phải `users.id`.
- "Mỗi user chỉ 1 địa chỉ default" được đảm bảo **bằng code** (transaction bỏ default cũ), không có ràng buộc DB.

---

## 4. ERD chi tiết — Product service

```mermaid
erDiagram
  categories ||--o{ products : "phân loại"
  brands ||--o{ products : "thương hiệu (tuỳ chọn)"
  products ||--o{ product_variants : "có biến thể"
  attributes ||--o{ attribute_values : "có giá trị"
  product_variants }o--o{ attribute_values : "product_variant_attribute_values"

  categories {
    uuid id PK
    varchar name
    varchar slug UK
    text description "nullable"
    timestamp createdAt
    timestamp updatedAt
  }
  brands {
    uuid id PK
    varchar name
    varchar slug UK
    text description "nullable"
    timestamp createdAt
    timestamp updatedAt
  }
  products {
    uuid id PK
    varchar name
    varchar slug UK
    text description
    numeric price "10,2"
    int stock "default 0"
    int lowStockThreshold "default 10"
    int version "optimistic lock"
    boolean isActive "default true"
    jsonb images "mảng object path MinIO, default []"
    uuid category_id FK "nullable, NO ACTION"
    uuid brand_id FK "nullable, NO ACTION"
    timestamp createdAt
    timestamp updatedAt
    timestamp deletedAt "nullable"
  }
  product_variants {
    uuid id PK
    uuid product_id FK "-> products.id, ON DELETE CASCADE"
    varchar sku UK "max 100"
    numeric price "10,2 nullable (null = dùng giá product)"
    int stock "default 0, kho riêng của variant"
    int version "optimistic lock"
    timestamp createdAt
    timestamp updatedAt
    timestamp deletedAt "soft delete, nullable"
  }
  attributes {
    uuid id PK
    varchar name UK "vd Color, Size"
    timestamp createdAt
    timestamp updatedAt
  }
  attribute_values {
    uuid id PK
    uuid attribute_id FK "-> attributes.id, ON DELETE CASCADE"
    varchar value "vd Red, XL"
    timestamp createdAt
    timestamp updatedAt
  }
  product_variant_attribute_values {
    uuid variant_id PK, FK "-> product_variants.id, CASCADE"
    uuid attribute_value_id PK, FK "-> attribute_values.id, NO ACTION"
  }
```

**Ràng buộc/quy tắc**
- Bảng nối `product_variant_attribute_values`: PK ghép `(variant_id, attribute_value_id)`, có index trên từng cột.
- `products.category_id` bắt buộc ở tầng code (404 nếu không tồn tại) nhưng cột DB **nullable**.
- `products.stock` và `product_variants.stock` là **hai kho độc lập**; trừ kho dùng `@VersionColumn` (retry 1 lần khi lệch version).
- Xoá product (cascade xuống variants ở DB, nhưng code dùng `remove` hard delete cho product và `softRemove` cho variant). Xoá `attribute_value` đang được variant dùng bị chặn (NO ACTION).
- Không có ràng buộc "mỗi variant chỉ 1 value cho mỗi attribute" — kiểm soát bằng code (hiện chưa kiểm tra).

---

## 5. ERD chi tiết — Orders service

```mermaid
erDiagram
  orders ||--|{ order_items : "gồm (cascade, eager)"
  orders ||--o{ refunds : "có thể hoàn tiền"

  orders {
    uuid id PK
    uuid userId "ref mềm -> users.userId"
    numeric subtotal "10,2"
    numeric taxAmount "10,2"
    numeric shippingFee "10,2"
    numeric totalAmount "10,2"
    enum status "PENDING|PROCESSING|PAID|SHIPPED|DELIVERED|CANCELLED|REFUNDED"
    varchar recipientName "snapshot địa chỉ"
    varchar recipientPhone
    varchar addressLine1
    varchar addressLine2 "nullable"
    varchar city
    varchar province "nullable"
    varchar postalCode "nullable"
    varchar country
    timestamp createdAt
    timestamp updatedAt
    timestamp deletedAt "soft delete, nullable"
  }
  order_items {
    uuid id PK
    uuid order_id FK "-> orders.id, ON DELETE CASCADE"
    uuid productId "ref mềm -> products.id"
    int quantity
    numeric unitPrice "10,2 snapshot giá lúc đặt"
  }
  refunds {
    uuid id PK
    uuid order_id FK "-> orders.id, ON DELETE CASCADE"
    numeric amount "10,2"
    text reason
    enum status "PENDING|APPROVED|REJECTED|COMPLETED"
    timestamp createdAt
    timestamp updatedAt
  }
  outbox {
    uuid id PK
    varchar eventType "order.created | order.status_updated"
    jsonb payload
    enum status "PENDING|PUBLISHED|FAILED"
    int retryCount "default 0"
    timestamp createdAt
    timestamp publishedAt "nullable"
  }
```

**Ràng buộc/quy tắc**
- `outbox` **không có FK** tới `orders`; liên hệ nằm trong `payload.orderId`. Được ghi cùng transaction với thay đổi trạng thái đơn.
- Tổng tiền: `totalAmount = subtotal + taxAmount + shippingFee`; không có cột voucher/discount/paymentTransactionId.
- Chuyển trạng thái hợp lệ: PENDING→{PROCESSING,CANCELLED}, PROCESSING→{PAID,CANCELLED}, PAID→{SHIPPED,CANCELLED}, SHIPPED→DELIVERED, DELIVERED→REFUNDED (kiểm tra bằng code, không có CHECK constraint).
- `refunds.status = APPROVED` có trong enum nhưng code đi thẳng `PENDING → COMPLETED`. Tổng refund không bị REJECTED ≤ `orders.totalAmount` (kiểm tra bằng code, không lock).
- Giỏ hàng **không có bảng** — nằm ở Redis (`cart:{userId}`: `{items:[{productId,quantity}]}`).

---

## 6. ERD chi tiết — Payment, Notification, Review, Promotion

```mermaid
erDiagram
  payment_transactions {
    uuid id PK
    uuid orderId "ref mềm -> orders.id"
    varchar idempotencyKey UK "Orders dùng orderId làm key"
    numeric amount "10,2"
    enum status "SUCCEEDED|FAILED"
    varchar failureReason "nullable"
    timestamp createdAt
  }
  payment_webhook_logs {
    uuid id PK
    varchar eventId UK "khử trùng webhook"
    uuid orderId "ref mềm -> orders.id"
    timestamp processedAt
  }
  sent_notifications {
    uuid id PK
    enum channel "EMAIL|PUSH"
    varchar recipient "email, fallback userId"
    varchar subject
    text body
    enum status "SENT|FAILED"
    varchar sourceEvent "nullable, vd order.created"
    timestamp createdAt
  }
  reviews {
    uuid id PK
    uuid userId "ref mềm -> users.userId"
    uuid productId "ref mềm -> products.id"
    uuid orderId "ref mềm -> orders.id"
    int rating "1..5 (validate ở DTO)"
    text comment "nullable"
    timestamp createdAt
  }
  vouchers {
    uuid id PK
    varchar code UK "max 50, phân biệt hoa thường"
    enum discountType "PERCENTAGE|FIXED"
    numeric discountValue "10,2"
    numeric minOrderValue "10,2 default 0"
    timestamp expiresAt
    int usageLimit
    int usageCount "default 0"
    timestamp createdAt
  }
```

**Ràng buộc/quy tắc**
- `reviews`: `UNIQUE(userId, productId, orderId)` — mỗi (user, sản phẩm, đơn) chỉ review một lần. `rating` chỉ được kiểm tra ở DTO (`@Min(1) @Max(5)`), không có CHECK trong DB.
- `payment_transactions.idempotencyKey` unique chống lưu trùng, nhưng không chặn việc gọi provider hai lần trong cuộc đua (xem [design-trade-offs.md](./design-trade-offs.md)).
- `vouchers.usageCount` được cập nhật dưới `SELECT … FOR UPDATE` (pessimistic lock).
- Nhóm bảng này không có FK nào ra ngoài (xem sơ đồ tổng thể mục 2 cho các tham chiếu mềm).

---

## 7. Index & ràng buộc duy nhất (tổng hợp)

| Bảng | Unique / Index |
|---|---|
| users | `email` (UK), `id` (index), `userId` (không unique ở DB — chỉ `@Generated`) |
| roles | `name` (UK) |
| user_roles | `(user_id, role_id)` (UK) |
| categories / brands | `slug` (UK) |
| products | `slug` (UK) — index `createdAt` đã bị migration InitSchema xoá |
| product_variants | `sku` (UK) |
| attributes | `name` (UK) |
| product_variant_attribute_values | PK `(variant_id, attribute_value_id)`, index từng cột |
| payment_transactions | `idempotencyKey` (UK) |
| payment_webhook_logs | `eventId` (UK) |
| reviews | `(userId, productId, orderId)` (UK) |
| vouchers | `code` (UK) |

**Thiếu index đáng chú ý** (đề xuất, chưa có trong code): `orders(userId)`, `order_items(order_id)`, `refunds(order_id)`, `outbox(status, createdAt)`, `reviews(productId)`, `payment_transactions(orderId)`, `sent_notifications(recipient)`, trigram index cho `products.name` (tìm kiếm `ILIKE '%q%'`).

> Lưu ý: `users.userId` được các service khác dùng làm khoá tham chiếu nhưng **chưa có ràng buộc UNIQUE** ở DB (chỉ cột `uuid` sinh tự động). Nên thêm unique index.

---

## 8. Quy ước & khác biệt cần biết

- **Kiểu tiền**: `numeric(10,2)` (TypeORM trả string; code ép `Number()`). Trần ~99.999.999,99 — có thể không đủ cho VND giá trị lớn.
- **Enum PostgreSQL**: `orders_status_enum`, `refunds_status_enum`, `outbox_status_enum`, `payment_transactions_status_enum`, `sent_notifications_channel_enum`, `sent_notifications_status_enum`, `vouchers_discounttype_enum`.
- **Soft delete (`deletedAt`)**: `users`, `products`, `orders`, `product_variants`. Thực tế chỉ variant dùng `softRemove`; product bị `remove` (xoá cứng).
- **Khoá chính**: `uuid` (`uuid_generate_v4()`), ngoại lệ `users.id` (serial) và bảng nối (PK ghép).
- **Không database-per-service**: muốn tách DB về sau, mọi liên kết giữa các cụm ở mục 2 đã là tham chiếu mềm nên chỉ cần chuyển bảng theo cụm.
- Dữ liệu seed (`npm run seed`) ghi thẳng bằng `pg` vào các bảng trên (~50.000 products, 20.000 orders, 2.000 users).

---

## 9. Tài liệu liên quan
- [module-processing-flows.md](./module-processing-flows.md) — cách từng service đọc/ghi các bảng này
- [business-flows.md](./business-flows.md) — rule nghiệp vụ trên dữ liệu (state machine đơn, refund, voucher)
- [design-trade-offs.md](./design-trade-offs.md) — vì sao tham chiếu mềm, một DB chung, kiểu tiền
- [onboarding-guide.md](./onboarding-guide.md)
