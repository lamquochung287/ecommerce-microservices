import { CommandBus } from '@nestjs/cqrs';
import { Repository } from 'typeorm';
import { ConfirmOrderPaymentHandler } from './confirm-order-payment.handler';
import { ConfirmOrderPaymentCommand } from '../confirm-order-payment.command';
import { UpdateOrderStatusCommand } from '../update-order-status.command';
import { Order, OrderStatus } from '../../entities/order.entity';

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

function setup(statuses: Array<OrderStatus | null>) {
	const findOne = jest.fn();
	statuses.forEach((status) =>
		findOne.mockResolvedValueOnce(
			status ? ({ id: ORDER_ID, status } as Order) : null,
		),
	);
	const execute = jest.fn().mockResolvedValue({});
	const handler = new ConfirmOrderPaymentHandler(
		{ findOne } as unknown as Repository<Order>,
		{ execute } as unknown as CommandBus,
	);
	// Không chờ thật giữa các lần thử lại.
	const sleep = jest
		.spyOn(handler as unknown as { sleep: () => Promise<void> }, 'sleep')
		.mockResolvedValue();
	return { handler, findOne, execute, sleep };
}

const run = (handler: ConfirmOrderPaymentHandler) =>
	handler.execute(new ConfirmOrderPaymentCommand(ORDER_ID));

describe('ConfirmOrderPaymentHandler', () => {
	it('chuyển đơn PROCESSING sang PAID qua UpdateOrderStatusCommand', async () => {
		const { handler, execute } = setup([OrderStatus.PROCESSING]);

		await run(handler);

		expect(execute).toHaveBeenCalledTimes(1);
		const command = execute.mock.calls[0][0] as UpdateOrderStatusCommand;
		expect(command).toBeInstanceOf(UpdateOrderStatusCommand);
		expect(command.id).toBe(ORDER_ID);
		expect(command.dto.status).toBe(OrderStatus.PAID);
	});

	it('chờ rồi chuyển PAID khi event tới lúc đơn còn PENDING (Saga chưa kịp sang PROCESSING)', async () => {
		const { handler, execute, sleep } = setup([
			OrderStatus.PENDING,
			OrderStatus.PENDING,
			OrderStatus.PROCESSING,
		]);

		await run(handler);

		expect(sleep).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('bỏ cuộc không throw nếu đơn vẫn PENDING sau số lần thử tối đa', async () => {
		const { handler, execute } = setup(Array(10).fill(OrderStatus.PENDING));

		await expect(run(handler)).resolves.toBeUndefined();
		expect(execute).not.toHaveBeenCalled();
	});

	it.each([
		OrderStatus.PAID,
		OrderStatus.SHIPPED,
		OrderStatus.DELIVERED,
		OrderStatus.REFUNDED,
	])('bỏ qua khi đơn đã %s (event lặp lại)', async (status) => {
		const { handler, execute } = setup([status]);

		await run(handler);

		expect(execute).not.toHaveBeenCalled();
	});

	it('không đổi trạng thái đơn đã CANCELLED', async () => {
		const { handler, execute } = setup([OrderStatus.CANCELLED]);

		await run(handler);

		expect(execute).not.toHaveBeenCalled();
	});

	it('bỏ qua khi không tìm thấy đơn', async () => {
		const { handler, execute } = setup([null]);

		await run(handler);

		expect(execute).not.toHaveBeenCalled();
	});

	it('không throw khi chuyển trạng thái lỗi (vd đã bị đổi bởi luồng khác)', async () => {
		const { handler, execute } = setup([OrderStatus.PROCESSING]);
		execute.mockRejectedValue(new Error('invalid transition'));

		await expect(run(handler)).resolves.toBeUndefined();
	});
});
