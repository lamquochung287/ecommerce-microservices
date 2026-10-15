import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { SimulatePaymentHandler } from './simulate-payment.handler';
import { SimulatePaymentCommand } from '../simulate-payment.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';
import { SimulatedPaymentProvider } from '../../providers/simulated-payment.provider';

const INTENT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function setup(nodeEnv: string | undefined, intent: unknown) {
	const config = {
		get: (key: string, fallback?: string) =>
			key === 'NODE_ENV' ? nodeEnv : fallback,
		getOrThrow: () => 'test-secret',
	} as unknown as ConfigService;
	const repo = {
		findOne: jest.fn().mockResolvedValue(intent),
	} as unknown as Repository<PaymentTransaction>;
	return new SimulatePaymentHandler(
		repo,
		new SimulatedPaymentProvider(config),
		config,
	);
}

const cmd = (result: 'success' | 'fail') =>
	new SimulatePaymentCommand({ intentId: INTENT_ID, result });

describe('SimulatePaymentHandler', () => {
	it('NODE_ENV=production: 404, không đọc DB', async () => {
		const handler = setup('production', null);
		await expect(handler.execute(cmd('success'))).rejects.toMatchObject({
			error: { statusCode: 404 },
		});
	});

	it('trả payload ký sẵn với eventId tất định `${intentId}:success`', async () => {
		const handler = setup('development', {
			id: INTENT_ID,
			orderId: ORDER_ID,
			amount: '230000.00',
			status: PaymentTransactionStatus.PENDING,
		});

		const out = await handler.execute(cmd('success'));
		const again = await handler.execute(cmd('success'));

		expect(out.payload.eventId).toBe(`${INTENT_ID}:success`);
		expect(again.payload.eventId).toBe(out.payload.eventId);
		expect(out.payload).toMatchObject({
			intentId: INTENT_ID,
			orderId: ORDER_ID,
			status: 'SUCCEEDED',
			amount: 230000,
		});
		expect(typeof out.signature).toBe('string');
	});

	it('intent đã CANCELLED vẫn mô phỏng được (thanh toán muộn)', async () => {
		const handler = setup(undefined, {
			id: INTENT_ID,
			orderId: ORDER_ID,
			amount: 1000,
			status: PaymentTransactionStatus.CANCELLED,
		});
		await expect(handler.execute(cmd('success'))).resolves.toBeDefined();
	});

	it('intent không tồn tại: 404', async () => {
		const handler = setup('development', null);
		await expect(handler.execute(cmd('fail'))).rejects.toMatchObject({
			error: { statusCode: 404 },
		});
	});
});
