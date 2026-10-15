# Hướng dẫn cho AI Agents - Product Module

## Vai trò
Microservice TCP :3003: Product, Category, Brand, Attribute/AttributeValue, Variant — **chỉ catalog**; tồn kho thuộc `apps/inventory`. **Bắt buộc CQRS** (`commands/`, `queries/`, `events/`, `handlers/`).
Chi tiết: [docs/module-processing-flows.md §3](../../docs/module-processing-flows.md).

## Mô hình dữ liệu
`Product{slug unique, price, lowStockThreshold=10, @VersionColumn, isActive, images jsonb, category, brand?}` · `ProductVariant{sku unique, price? (null = dùng giá product), @VersionColumn, M:N AttributeValue}` · `Attribute{name unique} 1:N AttributeValue`.
Không còn cột `stock` (migration `FinalizeOrderStatusAndStockOwnership` đã bỏ). Tồn kho = `stock_items` của Inventory (Gateway ghép `available`/`stockStatus` vào catalog; điều chỉnh tay qua `INVENTORY.ADJUST_STOCK`). Sản phẩm/variant mới chưa có dòng `stock_items` cho tới khi Inventory `ADJUST_STOCK` lần đầu (available = 0).

## Quy tắc
- Create Product: category phải tồn tại (404), brand nếu có (404); publish `ProductCreatedEvent` (handler hiện chỉ `console.log`, stub cho search).
- Update: `categoryId` null → 400; `brandId: null` gỡ brand.
- Variant: `sku` unique (409), mọi `attributeValueIds` phải tồn tại (404). Xoá Variant = `softRemove`; xoá Product/Brand/Attribute = hard `remove` (không chặn khi đã có order tham chiếu — tham chiếu mềm bằng UUID).
- `getProducts`: filter category/brand/giá/isActive/search (`ILIKE %q%`, chưa có index), sort chỉ whitelist `name|price|createdAt`, trả `{data, meta}` (`buildPaginationMeta`). `getProduct` chỉ kèm `category`.
- `ADJUST_STOCK` của Product (trừ/hoàn kho kiểu cũ) **đã bị xoá**; không thêm logic tồn kho vào Product.

## Gotchas
- `lowStockThreshold` có cột nhưng chưa có logic cảnh báo (tồn kho nay ở Inventory).
- Chưa cache catalog.
