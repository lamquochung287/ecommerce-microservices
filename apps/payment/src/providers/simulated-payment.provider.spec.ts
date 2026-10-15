import { ConfigService } from '@nestjs/config';
import { SimulatedPaymentProvider } from './simulated-payment.provider';

function makeProvider(env: Record<string, string | undefined> = {}) {
	const values: Record<string, string | undefined> = {
		PAYMENT_WEBHOOK_SECRET: 'test-secret',
		...env,
	};
	const config = {
		get: (key: string, fallback?: string) => values[key] ?? fallback,
		getOrThrow: (key: string) => {
			const v = values[key];
			if (v === undefined) throw new Error(`missing ${key}`);
			return v;
		},
	} as unknown as ConfigService;
	return new SimulatedPaymentProvider(config);
}

const INTENT = {
	id: '11111111-1111-4111-8111-111111111111',
	orderId: '22222222-2222-4222-8222-222222222222',
	amount: 230000,
};

describe('SimulatedPaymentProvider', () => {
	it('buildWebhook: eventId tất định theo intent + kết quả, chữ ký verify được', () => {
		const provider = makeProvider();
		const ok = provider.buildWebhook(INTENT, 'success');
		const again = provider.buildWebhook(INTENT, 'success');
		const fail = provider.buildWebhook(INTENT, 'fail');

		expect(ok.payload.eventId).toBe(`${INTENT.id}:success`);
		expect(again.payload.eventId).toBe(ok.payload.eventId);
		expect(fail.payload.eventId).toBe(`${INTENT.id}:fail`);
		expect(ok.payload).toMatchObject({
			intentId: INTENT.id,
			orderId: INTENT.orderId,
			status: 'SUCCEEDED',
			amount: 230000,
		});
		expect(fail.payload.status).toBe('FAILED');
		expect(provider.verifyWebhook(ok.payload, ok.signature)).toEqual({
			valid: true,
			eventId: `${INTENT.id}:success`,
			orderId: INTENT.orderId,
		});
	});

	it('sửa một trường của payload thì chữ ký không còn hợp lệ', () => {
		const provider = makeProvider();
		const { payload, signature } = provider.buildWebhook(INTENT, 'success');
		expect(
			provider.verifyWebhook({ ...payload, amount: 1 }, signature).valid,
		).toBe(false);
	});

	it('chữ ký khác độ dài hoặc sai kiểu trả false, không ném lỗi', () => {
		const provider = makeProvider();
		const { payload, signature } = provider.buildWebhook(INTENT, 'success');
		expect(provider.verifyWebhook(payload, signature.slice(0, -2)).valid).toBe(
			false,
		);
		expect(provider.verifyWebhook(payload, '').valid).toBe(false);
		expect(
			provider.verifyWebhook(payload, undefined as unknown as string).valid,
		).toBe(false);
	});

	it('ký bằng secret khác thì bị từ chối', () => {
		const signed = makeProvider({
			PAYMENT_WEBHOOK_SECRET: 'other-secret',
		}).buildWebhook(INTENT, 'success');
		expect(
			makeProvider().verifyWebhook(signed.payload, signed.signature).valid,
		).toBe(false);
	});

	it('không có secret thì ném lỗi, không dùng giá trị mặc định', () => {
		const provider = makeProvider({ PAYMENT_WEBHOOK_SECRET: undefined });
		expect(() => provider.buildWebhook(INTENT, 'success')).toThrow(
			'PAYMENT_WEBHOOK_SECRET',
		);
	});

	it('createIntent: checkoutUrl trỏ về /simulator/pay/{intentId}, bỏ dấu / cuối của base', () => {
		const provider = makeProvider({
			PUBLIC_API_BASE_URL: 'https://shop.example.com/',
		});
		expect(
			provider.createIntent({
				intentId: INTENT.id,
				orderId: INTENT.orderId,
				amount: 1,
				expiresAt: new Date(),
			}),
		).toEqual({
			checkoutUrl: `https://shop.example.com/simulator/pay/${INTENT.id}`,
		});
	});

	it('createIntent: base mặc định http://localhost:3000', () => {
		const { checkoutUrl } = makeProvider().createIntent({
			intentId: INTENT.id,
			orderId: INTENT.orderId,
			amount: 1,
			expiresAt: new Date(),
		});
		expect(checkoutUrl).toBe(
			`http://localhost:3000/simulator/pay/${INTENT.id}`,
		);
	});
});
