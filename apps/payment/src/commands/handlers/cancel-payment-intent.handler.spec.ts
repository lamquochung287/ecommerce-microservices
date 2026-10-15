import { EntityManager } from 'typeorm';
import { CancelPaymentIntentHandler } from './cancel-payment-intent.handler';
import { CancelPaymentIntentCommand } from '../cancel-payment-intent.command';
import {
	PaymentTransaction,
	PaymentTransactionStatus,
} from '../../entities/payment-transaction.entity';

const ORDER_ID = '22222222-2222-4222-8222-222222222222';

describe('CancelPaymentIntentHandler', () => {
	it('intent PENDING: UPDATE có điều kiện status=PENDING sang CANCELLED', async () => {
		const update = jest.fn().mockResolvedValue({ affected: 1 });
		const manager = { update } as unknown as EntityManager;

		const out = await new CancelPaymentIntentHandler().execute(
			new CancelPaymentIntentCommand(manager, ORDER_ID),
		);

		expect(out).toEqual({ cancelled: true });
		expect(update).toHaveBeenCalledWith(
			PaymentTransaction,
			{ orderId: ORDER_ID, status: PaymentTransactionStatus.PENDING },
			{ status: PaymentTransactionStatus.CANCELLED },
		);
	});

	it('intent đã SUCCEEDED/FAILED/CANCELLED (UPDATE không khớp dòng nào): no-op', async () => {
		const update = jest.fn().mockResolvedValue({ affected: 0 });
		const manager = { update } as unknown as EntityManager;

		const out = await new CancelPaymentIntentHandler().execute(
			new CancelPaymentIntentCommand(manager, ORDER_ID),
		);

		expect(out).toEqual({ cancelled: false });
	});
});
