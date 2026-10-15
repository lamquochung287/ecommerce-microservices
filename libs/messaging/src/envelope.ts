import { randomUUID } from 'crypto';

export const ENVELOPE_VERSION = 1;

/** Phong bì chuẩn cho mọi event/command trên Kafka; command và event phân biệt qua `type` + topic. */
export interface MessageEnvelope<T = unknown> {
	eventId: string;
	type: string;
	orderId: string;
	occurredAt: string;
	version: number;
	payload: T;
}

export function createEnvelope<T>(params: {
	type: string;
	orderId: string;
	payload: T;
	eventId?: string;
	occurredAt?: Date;
}): MessageEnvelope<T> {
	return {
		eventId: params.eventId ?? randomUUID(),
		type: params.type,
		orderId: params.orderId,
		occurredAt: (params.occurredAt ?? new Date()).toISOString(),
		version: ENVELOPE_VERSION,
		payload: params.payload,
	};
}

const isNonEmptyString = (v: unknown): v is string =>
	typeof v === 'string' && v.length > 0;

/** Chỉ kiểm tra các trường định tuyến/khử trùng; hình dạng payload do handler từng loại tự chịu trách nhiệm. */
export function isValidEnvelope(value: unknown): value is MessageEnvelope {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		isNonEmptyString(v.eventId) &&
		isNonEmptyString(v.type) &&
		isNonEmptyString(v.orderId) &&
		isNonEmptyString(v.occurredAt) &&
		typeof v.version === 'number' &&
		'payload' in v
	);
}
