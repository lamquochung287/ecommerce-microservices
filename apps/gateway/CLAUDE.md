# Hướng dẫn cho AI Agents - Gateway Module (AGENTS_GUIDE.md)

## Vai trò
Đây là API Gateway, điểm entry duy nhất tiếp nhận HTTP request từ Client (RESTful API).
Gateway **không** chứa logic nghiệp vụ, mà chỉ làm nhiệm vụ:
1. Authentication/Authorization (Kiểm tra Token, Phân quyền).
2. Routing & Phân phối request tới các Microservices qua TCP.
3. Tổng hợp kết quả và trả về cho Client.
4. Bắt và map các exception từ Microservice (`RpcException`) thành `HttpException` chuẩn hóa (thông qua Exception Filters).

## Cấu trúc và Kiến trúc Endpoints
- **Controllers**: Nơi định nghĩa các endpoint (routes). Nhiệm vụ chính là validate đầu vào (thông qua DTO) và gọi sang Service.
- **Services (Clients)**: Khởi tạo kết nối TCP (`ClientProxy`) tới các microservice khác. Nơi chứa logic giao tiếp (gửi message/event) đi các service con.
- **DTOs**: Chứa các interface/class validation (`class-validator`) request body từ client.
- **Filters**: Sử dụng `HttpExceptionFilter` để chuẩn hóa toàn bộ format error trả về cho client.

## Quy tắc lập trình tại Gateway
- **Không viết Business Logic**: Controller chỉ validate input, gọi sang Microservice tương ứng qua Service (ClientProxy), và trả về kết quả. Toàn bộ logic lưu trữ, kiểm tra nghiệp vụ phải diễn ra ở Microservice.
- **Xử lý Timeout & Fallback**: Khi gọi qua TCP, luôn cần xem xét handle timeout (ví dụ dùng RxJS `timeout()`) tránh việc treo request HTTP của client quá lâu.
