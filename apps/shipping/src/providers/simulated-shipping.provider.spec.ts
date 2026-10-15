import { ConfigService } from '@nestjs/config';
import { SimulatedShippingProvider } from './simulated-shipping.provider';

const INPUT = {
	orderId: '11111111-1111-4111-8111-111111111111',
	recipient: {
		recipientName: 'A',
		recipientPhone: '0900000000',
		addressLine1: '1 Main St',
		city: 'HCM',
		country: 'VN',
	},
	items: [{ productId: 'p1', quantity: 1 }],
};

const build = (values: Record<string, string | undefined>) =>
	new SimulatedShippingProvider({
		get: (key: string, fallback?: string) => values[key] ?? fallback,
		getOrThrow: (key: string) => {
			const value = values[key];
			if (value === undefined) throw new Error(`${key} missing`);
			return value;
		},
	} as unknown as ConfigService);

describe('SimulatedShippingProvider', () => {
	it('tạo vận đơn với trackingCode SIM-<random> khác nhau mỗi lần', async () => {
		const provider = build({});

		const a = await provider.createShipment(INPUT);
		const b = await provider.createShipment(INPUT);

		expect(a.trackingCode).toMatch(/^SIM-[0-9A-F]{12}$/);
		expect(a.carrier).toBe('SIMULATED');
		expect(a.trackingCode).not.toBe(b.trackingCode);
	});

	it('SHIPPING_SIM_MODE=fail: luôn ném lỗi', async () => {
		const provider = build({ SHIPPING_SIM_MODE: 'fail' });

		await expect(provider.createShipment(INPUT)).rejects.toThrow(
			'Simulated carrier failure',
		);
	});

	it('cancelShipment không ném', async () => {
		await expect(build({}).cancelShipment('SIM-1')).resolves.toBeUndefined();
	});

	describe('webhook HMAC', () => {
		const provider = build({ SHIPPING_WEBHOOK_SECRET: 'secret-a' });
		const payload = { eventId: 'e1', orderId: 'o1', status: 'DELIVERED' };

		it('chữ ký do chính provider ký thì hợp lệ', () => {
			expect(
				provider.verifyWebhook(payload, provider.signWebhook(payload)),
			).toBe(true);
		});

		it('payload bị sửa, chữ ký khác độ dài, không phải chuỗi: không hợp lệ', () => {
			const signature = provider.signWebhook(payload);

			expect(
				provider.verifyWebhook({ ...payload, status: 'LOST' }, signature),
			).toBe(false);
			expect(provider.verifyWebhook(payload, 'short')).toBe(false);
			expect(
				provider.verifyWebhook(payload, undefined as unknown as string),
			).toBe(false);
		});

		it('ký bằng secret khác thì không hợp lệ', () => {
			const other = build({ SHIPPING_WEBHOOK_SECRET: 'secret-b' });

			expect(provider.verifyWebhook(payload, other.signWebhook(payload))).toBe(
				false,
			);
		});

		it('thiếu SHIPPING_WEBHOOK_SECRET: ném lỗi thay vì ký bằng khoá rỗng', () => {
			expect(() => build({}).signWebhook(payload)).toThrow(
				'SHIPPING_WEBHOOK_SECRET missing',
			);
		});
	});
});
