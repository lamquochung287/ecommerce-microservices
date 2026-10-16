import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/**
 * Route không yêu cầu đăng nhập: JwtAuthGuard và PermissionGuard bỏ qua. Vẫn phải có header `x-api-key`
 * (RequestTrackerMiddleware) và vẫn chịu throttle. Mặc định mọi route của controller đã gắn guard vẫn cần đăng nhập.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
