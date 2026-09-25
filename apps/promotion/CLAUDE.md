# Hướng dẫn cho AI Agents - Promotion Module (AGENTS_GUIDE.md)

## Vai trò
Microservice quản lý voucher/coupon giảm giá.

## Chức năng chính
- CreateVoucher: code, discount type (PERCENTAGE/FIXED), min order value, expiry, usage limit.
- GetAvailableVouchers: voucher còn hiệu lực (chưa hết hạn, chưa đạt usage limit).
- ApplyVoucher: tính discount cho 1 order value, validate min order value/expiry/usage limit, tăng
  usageCount khi apply thành công.

## Kiến trúc CQRS
Áp dụng CQRS (`@nestjs/cqrs`) theo chuẩn chung của dự án.

## Quy tắc lập trình tại Promotion Service
- ApplyVoucher chỉ tính toán discount và trả kết quả — không tự trừ tiền/tạo order. Orders service là
  nơi quyết định có áp dụng discount vào order hay không.
