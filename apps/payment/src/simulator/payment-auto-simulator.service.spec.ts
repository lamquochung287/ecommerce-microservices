// Mock bus trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { PaymentAutoSimulatorService } from './payment-auto-simulator.service';
import { HandlePaymentWebhookCommand } from '../commands/handle-payment-webhook.command';
import { SimulatedPaymentProvider } from '../providers/simulated-payment.provider';

const INTENT = {
	id: '11111111-1111-4111-8111-111111111111',
	orderId: '22222222-2222-4222-8222-222222222222',
	amount: 230000,
};

function setup(env: Record<string, string | number | undefined>) {
	const config = {
		get: (key: string, fallback?: unknown) => env[key] ?? fallback,
		getOrThrow: () => 'test-secret',
	} as unknown as ConfigService;
	const execute = jest.fn().mockResolvedValue({ processed: true });
	const provider = new SimulatedPaymentProvider(config);
	const service = new PaymentAutoSimulatorService(
		config,
		{ execute } as unknown as CommandBus,
		provider,
	);
	return { service, execute, provider };
}

describe('PaymentAutoSimulatorService', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('auto-success: sau delay gọi HandleWebhook với payload SUCCEEDED và chữ ký hợp lệ', async () => {
		const { service, execute, provider } = setup({
			PAYMENT_SIM_MODE: 'auto-success',
			PAYMENT_SIM_DELAY_MS: 500,
		});

		service.schedule(INTENT);
		await jest.advanceTimersByTimeAsync(499);
		expect(execute).not.toHaveBeenCalled();
		await jest.advanceTimersByTimeAsync(1);

		expect(execute).toHaveBeenCalledTimes(1);
		const command = execute.mock.calls[0][0] as HandlePaymentWebhookCommand;
		expect(command).toBeInstanceOf(HandlePaymentWebhookCommand);
		expect(command.dto.payload).toMatchObject({
			eventId: `${INTENT.id}:success`,
			status: 'SUCCEEDED',
		});
		expect(
			provider.verifyWebhook(command.dto.payload, command.dto.signature).valid,
		).toBe(true);
	});

	it('auto-fail: gửi webhook FAILED', async () => {
		const { service, execute } = setup({
			PAYMENT_SIM_MODE: 'auto-fail',
			PAYMENT_SIM_DELAY_MS: 10,
		});
		service.schedule(INTENT);
		await jest.advanceTimersByTimeAsync(10);
		expect(
			(execute.mock.calls[0][0] as HandlePaymentWebhookCommand).dto.payload
				.status,
		).toBe('FAILED');
	});

	it('manual (mặc định): không hẹn giờ', async () => {
		const { service, execute } = setup({});
		service.schedule(INTENT);
		await jest.advanceTimersByTimeAsync(60000);
		expect(execute).not.toHaveBeenCalled();
	});

	it('production: tắt dù mode là auto', async () => {
		const { service, execute } = setup({
			PAYMENT_SIM_MODE: 'auto-success',
			PAYMENT_SIM_DELAY_MS: 1,
			NODE_ENV: 'production',
		});
		service.schedule(INTENT);
		await jest.advanceTimersByTimeAsync(1000);
		expect(execute).not.toHaveBeenCalled();
	});

	it('webhook lỗi thì chỉ log, không làm sập process', async () => {
		const { service, execute } = setup({
			PAYMENT_SIM_MODE: 'auto-success',
			PAYMENT_SIM_DELAY_MS: 1,
		});
		execute.mockRejectedValueOnce(new Error('db down'));
		service.schedule(INTENT);
		await expect(jest.advanceTimersByTimeAsync(1)).resolves.not.toThrow();
	});

	it('onModuleDestroy huỷ timer đang chờ', async () => {
		const { service, execute } = setup({
			PAYMENT_SIM_MODE: 'auto-success',
			PAYMENT_SIM_DELAY_MS: 100,
		});
		service.schedule(INTENT);
		service.onModuleDestroy();
		await jest.advanceTimersByTimeAsync(1000);
		expect(execute).not.toHaveBeenCalled();
	});
});
