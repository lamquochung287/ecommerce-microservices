# Hướng dẫn cho AI Agents - Product Module

## Vai trò
Microservice TCP :3003: Product, Category, Brand, Attribute/AttributeValue, Variant và **tồn kho**. **Bắt buộc CQRS** (`commands/`, `queries/`, `events/`, `handlers/`).
Chi tiết: [docs/module-processing-flows.md §3](../../docs/module-processing-flows.md).

## Mô hình dữ liệu
`Product{slug unique, price, stock, lowStockThreshold=10, @VersionColumn, isActive, images jsonb, category, brand?}` · `ProductVariant{sku unique, price? (null = dùng giá product), stock, @VersionColumn, M:N AttributeValue}` · `Attribute{name unique} 1:N AttributeValue`.
**`Product.stock` và `Variant.stock` là hai kho độc lập** (không cộng dồn).

## AdjustStock (`adjust-stock.handler.ts`) — điểm quan trọng nhất
- Input `{productId | variantId, delta}`; thiếu cả hai → 400. Variant ưu tiên nếu có.
- Transaction: `next = stock + delta`; `< 0` → 409 "Không đủ tồn kho"; save (optimistic lock qua `version`); lỗi version → retry **1 lần**, vẫn lỗi → 409.
- Là **RPC duy nhất** cho trừ kho (delta âm, Orders gọi), hoàn kho (delta dương, compensation) và điều chỉnh tay. Không có "reserve" riêng → trừ là trừ thật.
- Mỗi `save()` Product (kể cả đổi mô tả) cũng bump `version` → có thể làm một lần trừ kho đang chạy bị retry.

## Quy tắc
- Create Product: category phải tồn tại (404), brand nếu có (404); publish `ProductCreatedEvent` (handler hiện chỉ `console.log`, stub cho search).
- Update: `categoryId` null → 400; `brandId: null` gỡ brand.
- Variant: `sku` unique (409), mọi `attributeValueIds` phải tồn tại (404). Xoá Variant = `softRemove`; xoá Product/Brand/Attribute = hard `remove` (không chặn khi đã có order tham chiếu — tham chiếu mềm bằng UUID).
- `getProducts`: filter category/brand/giá/isActive/search (`ILIKE %q%`, chưa có index), sort chỉ whitelist `name|price|stock|createdAt`, trả `{data, meta}` (`buildPaginationMeta`). `getProduct` chỉ kèm `category`.
- Mọi Command đổi tồn kho phải ACID (transaction).

## Gotchas
- `lowStockThreshold` có cột nhưng chưa có logic cảnh báo; chưa có lịch sử điều chỉnh kho.
- Chưa cache catalog. Khi tải cao cân nhắc `UPDATE … SET stock = stock - :q WHERE stock >= :q` thay optimistic lock.
