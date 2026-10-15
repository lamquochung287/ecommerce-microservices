// mock.calls của jest.fn() có kiểu any.

import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { SimulateDeliveryCommand } from '../commands/simulate-delivery.command';
import { DeliveryTimerService } from './delivery-timer.service';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const build = (delayMs: number, execute = jest.fn().mockResolvedValue({})) => {
	const config = {
		get: (_key: string, fallback: number) => delayMs ?? fallback,
	} as unknown as ConfigService;
	const service = new DeliveryTimerService(
		{ execute } as unknown as CommandBus,
		config,
	);
	return { service, execute };
};

describe('DeliveryTimerService', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('delay > 0: sau đúng delay gọi SimulateDelivery cho đơn', () => {
		const { service, execute } = build(5000);

		service.schedule(ORDER_ID);
		jest.advanceTimersByTime(4999);
		expect(execute).not.toHaveBeenCalled();
		jest.advanceTimersByTime(1);

		expect(execute).toHaveBeenCalledTimes(1);
		const command = (execute.mock.calls as [SimulateDeliveryCommand][])[0][0];
		expect(command).toBeInstanceOf(SimulateDeliveryCommand);
		expect(command.orderId).toBe(ORDER_ID);
	});

	it('delay = 0: không hẹn giờ', () => {
		const { service, execute } = build(0);

		service.schedule(ORDER_ID);
		jest.advanceTimersByTime(60_000);

		expect(execute).not.toHaveBeenCalled();
	});

	it('SimulateDelivery lỗi: không ném ra ngoài timer', async () => {
		const { service, execute } = build(
			10,
			jest.fn().mockRejectedValue(new Error('boom')),
		);

		service.schedule(ORDER_ID);
		jest.advanceTimersByTime(10);
		await Promise.resolve();

		expect(execute).toHaveBeenCalledTimes(1);
	});

	it('onModuleDestroy huỷ các timer chưa chạy', () => {
		const { service, execute } = build(1000);

		service.schedule(ORDER_ID);
		service.onModuleDestroy();
		jest.advanceTimersByTime(5000);

		expect(execute).not.toHaveBeenCalled();
	});
});
