export const MESSAGING_OPTIONS = 'MESSAGING_OPTIONS';

export interface MessagingModuleOptions {
	/** Giá trị cột outbox.source của service (xem OUTBOX_SOURCE). */
	source: string;
	/** false cho service chỉ consume/không cần relay. Mặc định true. */
	relay?: boolean;
}

/** Số row tối đa mỗi tick relay (giữ lock ngắn). */
export const OUTBOX_RELAY_BATCH_SIZE = 20;
