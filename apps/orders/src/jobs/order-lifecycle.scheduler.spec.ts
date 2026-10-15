// mock.calls của jest.fn() có kiểu any.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Logger } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CompleteDeliveredOrdersCommand } from '../commands/complete-delivered-orders.command';
import { ExpirePendingOrdersCommand } from '../commands/expire-pending-orders.command';
import {
	ORDER_LIFECYCLE_BATCH_SIZE,
	OrderLifecycleScheduler,
} from './order-lifecycle.scheduler';

// @nestjs/schedule chỉ phát hành ESM nên jest (CommonJS) không nạp được; scheduler chỉ cần decorator là no-op.
jest.mock('@nestjs/schedule', () => ({
	Cron: () => () => undefined,
	CronExpression: {
		EVERY_30_SECONDS: '*/30 * * * * *',
		EVERY_10_MINUTES: '0 */10 * * * *',
	},
}));

describe('OrderLifecycleScheduler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	it('quét hết hạn gửi ExpirePendingOrdersCommand với batch 100', async () => {
		const commandBus = { execute: jest.fn().mockResolvedValue({}) };
		const scheduler = new OrderLifecycleScheduler(
			commandBus as unknown as CommandBus,
		);
		await scheduler.expirePendingOrders();

		const command = commandBus.execute.mock.calls[0][0];
		expect(command).toBeInstanceOf(ExpirePendingOrdersCommand);
		expect(command.batchSize).toBe(ORDER_LIFECYCLE_BATCH_SIZE);
		expect(ORDER_LIFECYCLE_BATCH_SIZE).toBe(100);
	});

	it('tự hoàn tất gửi CompleteDeliveredOrdersCommand', async () => {
		const commandBus = { execute: jest.fn().mockResolvedValue({}) };
		const scheduler = new OrderLifecycleScheduler(
			commandBus as unknown as CommandBus,
		);
		await scheduler.completeDeliveredOrders();
		expect(commandBus.execute.mock.calls[0][0]).toBeInstanceOf(
			CompleteDeliveredOrdersCommand,
		);
	});

	it('không chạy chồng: lượt đang chạy thì lượt sau bỏ qua; xong thì chạy lại được', async () => {
		let release!: () => void;
		const commandBus = {
			execute: jest.fn(
				() => new Promise<void>((resolve) => (release = resolve)),
			),
		};
		const scheduler = new OrderLifecycleScheduler(
			commandBus as unknown as CommandBus,
		);

		const first = scheduler.expirePendingOrders();
		await scheduler.expirePendingOrders();
		expect(commandBus.execute).toHaveBeenCalledTimes(1);

		release();
		await first;
		const third = scheduler.expirePendingOrders();
		expect(commandBus.execute).toHaveBeenCalledTimes(2);
		release();
		await third;
	});

	it('lỗi của lượt quét không ném ra và không kẹt cờ', async () => {
		const commandBus = {
			execute: jest
				.fn()
				.mockRejectedValueOnce(new Error('db down'))
				.mockResolvedValue({}),
		};
		const scheduler = new OrderLifecycleScheduler(
			commandBus as unknown as CommandBus,
		);
		await expect(scheduler.completeDeliveredOrders()).resolves.toBeUndefined();
		await scheduler.completeDeliveredOrders();
		expect(commandBus.execute).toHaveBeenCalledTimes(2);
	});
});
