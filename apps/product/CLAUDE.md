# Hướng dẫn cho AI Agents - Product Module (AGENTS_GUIDE.md)

## Vai trò
Microservice quản lý nghiệp vụ liên quan đến Sản phẩm, Danh mục, và Kho hàng (Inventory).

## Chức năng chính
- CRUD (Tạo, đọc, sửa, xoá) sản phẩm, danh mục, thương hiệu.
- Quản lý số lượng tồn kho (đặt trước, trừ kho, hoàn kho).
- Tìm kiếm, lọc sản phẩm (trong tương lai có thể mở rộng index bằng Elasticsearch).

## Kiến trúc CQRS
Do nghiệp vụ sản phẩm rất phức tạp, module này **bắt buộc** áp dụng CQRS (Command Query Responsibility Segregation) pattern với `@nestjs/cqrs`.
- **Commands**: Nằm trong thư mục `commands/`. Dùng cho các thao tác thay đổi dữ liệu (Tạo mới, Cập nhật, Xoá, Trừ tồn kho).
- **Queries**: Nằm trong thư mục `queries/`. Dùng cho các thao tác đọc (Lấy chi tiết, Lấy danh sách, Phân trang, Search).
- **Handlers**: Mỗi command/query phải có một Handler đi kèm xử lý logic nghiệp vụ và tương tác với DB. Nằm ở `handlers/`.

## Quy tắc lập trình tại Product Service
- Chấp nhận các lệnh qua TCP Pattern từ Gateway (để client lấy thông tin) hoặc các service khác (như Orders khi cần check/trừ tồn kho).
- Đảm bảo tính nhất quán dữ liệu (ACID Transaction) khi xử lý các Command ảnh hưởng đến số lượng tồn kho.
