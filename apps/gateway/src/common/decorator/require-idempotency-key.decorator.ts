import { SetMetadata } from '@nestjs/common';

export const REQUIRE_IDEMPOTENCY_KEY = 'require_idempotency_key';

/**
 * Đánh dấu route ghi bắt buộc có header `x-idempotency-key`.
 * Thiếu header -> 400; Redis không dùng được -> 503 (không chạy handler mà thiếu bảo đảm chống trùng).
 */
export const RequireIdempotencyKey = () =>
	SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);
