import { createEnvelope, isValidEnvelope } from './envelope';

describe('envelope', () => {
	it('createEnvelope sets every field', () => {
		const env = createEnvelope({
			type: 'OrderPaid',
			orderId: 'o-1',
			payload: { userId: 'u-1' },
		});
		expect(env.eventId).toMatch(/^[0-9a-f-]{36}$/);
		expect(env.type).toBe('OrderPaid');
		expect(env.orderId).toBe('o-1');
		expect(env.version).toBe(1);
		expect(new Date(env.occurredAt).toISOString()).toBe(env.occurredAt);
		expect(env.payload).toEqual({ userId: 'u-1' });
		expect(isValidEnvelope(env)).toBe(true);
	});

	it('honours explicit eventId and occurredAt', () => {
		const at = new Date('2026-01-01T00:00:00.000Z');
		const env = createEnvelope({
			type: 'X',
			orderId: 'o',
			payload: {},
			eventId: 'fixed',
			occurredAt: at,
		});
		expect(env.eventId).toBe('fixed');
		expect(env.occurredAt).toBe(at.toISOString());
	});

	it.each(['eventId', 'type', 'orderId', 'occurredAt', 'version', 'payload'])(
		'isValidEnvelope rejects missing %s',
		(field) => {
			const env: Record<string, unknown> = {
				...createEnvelope({ type: 'X', orderId: 'o', payload: {} }),
			};
			delete env[field];
			expect(isValidEnvelope(env)).toBe(false);
		},
	);

	it.each([null, undefined, 'str', 42])('isValidEnvelope rejects %p', (v) => {
		expect(isValidEnvelope(v)).toBe(false);
	});

	it('isValidEnvelope rejects empty eventId', () => {
		const env = createEnvelope({
			type: 'X',
			orderId: 'o',
			payload: {},
			eventId: '',
		});
		expect(isValidEnvelope(env)).toBe(false);
	});
});
