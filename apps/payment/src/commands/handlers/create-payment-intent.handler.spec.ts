import { QueryFailedError, Repository } from 'typeorm';
import { CreatePaymentIntentHandler } from './create-payment-intent.handler';
import { CreatePaymentIntentCommand } from '../create-payment-intent.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';
import { PaymentProvider } from '../../providers/payment-provider.interface';
import { PaymentAutoSimulatorService } from '../../simulator/payment-auto-simulator.service';

const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const EXPIRES = '2026-10-15T10:15:00.000Z';
const DTO = {
	orderId: ORDER_ID,
	amount: 230000,
	idempotencyKey: ORDER_ID,
	expiresAt: EXPIRES,
};

function setup() {
	const findOne = jest.fn();
	const save = jest.fn((e: PaymentTransaction) => Promise.resolve(e));
	const repo = {
		findOne,
		save,
		create: jest.fn((e: Partial<PaymentTransaction>) => e),
	} as unknown as Repository<PaymentTransaction>;
	const createIntent = jest.fn(({ intentId }: { intentId: string }) => ({
		checkoutUrl: `http://localhost:3000/simulator/pay/${intentId}`,
	}));
	const provider = { createIntent } as unknown as PaymentProvider;
	const schedule = jest.fn();
	const simulator = { schedule } as unknown as PaymentAutoSimulatorService;
	const handler = new CreatePaymentIntentHandler(repo, provider, simulator);
	return { handler, findOne, save, createIntent, schedule };
}

describe('CreatePaymentIntentHandler', () => {
	it('intent mới: PENDING, checkoutUrl đúng dạng, expiresAt đúng bằng input, lên lịch auto-simulator', async () => {
		const { handler, findOne, save, createIntent, schedule } = setup();
		findOne.mockResolvedValue(null);

		const result = await handler.execute(new CreatePaymentIntentCommand(DTO));

		const saved = save.mock.calls[0][0];
		expect(saved.status).toBe(PaymentTransactionStatus.PENDING);
		expect(saved.orderId).toBe(ORDER_ID);
		expect((saved.expiresAt as Date).toISOString()).toBe(EXPIRES);
		expect(createIntent).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			intentId: saved.id,
			status: PaymentTransactionStatus.PENDING,
			checkoutUrl: `http://localhost:3000/simulator/pay/${saved.id}`,
			expiresAt: EXPIRES,
		});
		expect(schedule).toHaveBeenCalledWith(saved);
	});

	it.each([
		PaymentTransactionStatus.PENDING,
		PaymentTransactionStatus.CANCELLED,
		PaymentTransactionStatus.SUCCEEDED,
	])(
		'cùng idempotencyKey (intent đã %s): trả intent cũ, không gọi provider, không insert',
		async (status) => {
			const { handler, findOne, save, createIntent, schedule } = setup();
			findOne.mockResolvedValue({
				id: 'intent-1',
				status,
				checkoutUrl: 'http://x/simulator/pay/intent-1',
				expiresAt: new Date(EXPIRES),
			});

			const result = await handler.execute(new CreatePaymentIntentCommand(DTO));

			expect(result).toEqual({
				intentId: 'intent-1',
				status,
				checkoutUrl: 'http://x/simulator/pay/intent-1',
				expiresAt: EXPIRES,
			});
			expect(createIntent).not.toHaveBeenCalled();
			expect(save).not.toHaveBeenCalled();
			expect(schedule).not.toHaveBeenCalled();
		},
	);

	it('race: unique violation khi insert thì đọc lại intent của bên thắng, không lên lịch simulator', async () => {
		const { handler, findOne, save, schedule } = setup();
		const winner = {
			id: 'winner',
			status: PaymentTransactionStatus.PENDING,
			checkoutUrl: 'http://x/simulator/pay/winner',
			expiresAt: new Date(EXPIRES),
		};
		findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
		save.mockRejectedValueOnce(
			new QueryFailedError('INSERT', [], { code: '23505' } as unknown as Error),
		);

		const result = await handler.execute(new CreatePaymentIntentCommand(DTO));

		expect(result.intentId).toBe('winner');
		expect(schedule).not.toHaveBeenCalled();
	});

	it('lỗi insert khác unique violation thì ném lại', async () => {
		const { handler, findOne, save } = setup();
		findOne.mockResolvedValue(null);
		save.mockRejectedValueOnce(new Error('connection lost'));

		await expect(
			handler.execute(new CreatePaymentIntentCommand(DTO)),
		).rejects.toThrow('connection lost');
	});
});
