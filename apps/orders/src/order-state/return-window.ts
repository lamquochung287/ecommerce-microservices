import { ConfigService } from '@nestjs/config';

export const DEFAULT_RETURN_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Cửa sổ đổi trả (ms) tính từ deliveredAt; giá trị cấu hình không hợp lệ thì dùng mặc định. */
export function returnWindowMs(config: ConfigService): number {
	const days = Number(
		config.get<number>('ORDER_RETURN_WINDOW_DAYS', DEFAULT_RETURN_WINDOW_DAYS),
	);
	return (
		(Number.isFinite(days) && days > 0 ? days : DEFAULT_RETURN_WINDOW_DAYS) *
		DAY_MS
	);
}
