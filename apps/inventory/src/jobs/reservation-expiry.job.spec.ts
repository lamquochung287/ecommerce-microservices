// mock.calls của jest.fn() có kiểu any.
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { ExpireReservationsCommand } from '../commands/expire-reservations.command';
import {
	EXPIRY_BATCH_SIZE,
	ExpireReservationsHandler,
} from '../commands/handlers/expire-reservations.handler';
import { ReservationService } from '../domain/reservation.service';
import { ReservationExpiryJob } from './reservation-expiry.job';

// @nestjs/schedule chỉ phát hành ESM nên jest (CommonJS) không nạp được; job chỉ cần decorator là no-op.
jest.mock('@nestjs/schedule', () => ({
	Cron: () => () => undefined,
	CronExpression: { EVERY_30_SECONDS: '*/30 * * * * *' },
}));

const config = (grace?: number) =>
	({
		get: (_key: string, fallback: number) => grace ?? fallback,
	}) as unknown as ConfigService;

describe('ReservationExpiryJob', () => {
	it('gửi command với grace từ config', async () => {
		const commandBus = { execute: jest.fn().mockResolvedValue({}) };
		const job = new ReservationExpiryJob(
			commandBus as unknown as CommandBus,
			config(120),
		);

		await job.run();

		expect(commandBus.execute).toHaveBeenCalledWith(
			expect.objectContaining({ graceSeconds: 120 }),
		);
	});

	it('grace mặc định 60 giây', async () => {
		const commandBus = { execute: jest.fn().mockResolvedValue({}) };
		await new ReservationExpiryJob(
			commandBus as unknown as CommandBus,
			config(),
		).run();

		expect(commandBus.execute).toHaveBeenCalledWith(
			expect.objectContaining({ graceSeconds: 60 }),
		);
	});

	it('lỗi không làm job throw và lượt sau vẫn chạy', async () => {
		const commandBus = {
			execute: jest
				.fn()
				.mockRejectedValueOnce(new Error('db down'))
				.mockResolvedValue({}),
		};
		const job = new ReservationExpiryJob(
			commandBus as unknown as CommandBus,
			config(),
		);

		await expect(job.run()).resolves.toBeUndefined();
		await job.run();

		expect(commandBus.execute).toHaveBeenCalledTimes(2);
	});

	it('không chạy chồng khi lượt trước chưa xong', async () => {
		let finish!: () => void;
		const commandBus = {
			execute: jest.fn(
				() => new Promise<void>((resolve) => (finish = resolve)),
			),
		};
		const job = new ReservationExpiryJob(
			commandBus as unknown as CommandBus,
			config(),
		);

		const first = job.run();
		await job.run();
		finish();
		await first;

		expect(commandBus.execute).toHaveBeenCalledTimes(1);
	});
});

describe('ExpireReservationsHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	const makeHandler = (service: Partial<ReservationService>) => {
		const manager = {};
		const dataSource = {
			manager,
			transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
		};
		return {
			handler: new ExpireReservationsHandler(
				dataSource as never,
				service as ReservationService,
			),
			manager,
		};
	};

	it('ngưỡng = now - grace; mỗi reservation 1 transaction', async () => {
		const service = {
			findExpiredIds: jest.fn().mockResolvedValue(['a', 'b']),
			expireOne: jest.fn().mockResolvedValue(true),
		};
		const { handler, manager } = makeHandler(service);
		const before = Date.now();

		const result = await handler.execute(new ExpireReservationsCommand(60));

		expect(result).toEqual({ expired: 2, failed: 0 });
		const threshold = service.findExpiredIds.mock.calls[0][1] as Date;
		expect(threshold.getTime()).toBeLessThanOrEqual(Date.now() - 60_000);
		expect(threshold.getTime()).toBeGreaterThanOrEqual(before - 60_000 - 5);
		expect(service.findExpiredIds.mock.calls[0][2]).toBe(EXPIRY_BATCH_SIZE);
		expect(service.expireOne).toHaveBeenCalledTimes(2);
		expect(service.expireOne.mock.calls[0][0]).toBe(manager);
	});

	it('một reservation lỗi không chặn các reservation còn lại', async () => {
		const service = {
			findExpiredIds: jest.fn().mockResolvedValue(['a', 'b', 'c']),
			expireOne: jest
				.fn()
				.mockResolvedValueOnce(true)
				.mockRejectedValueOnce(new Error('lock timeout'))
				.mockResolvedValueOnce(true),
		};
		const { handler } = makeHandler(service);

		const result = await handler.execute(new ExpireReservationsCommand(0));

		expect(result).toEqual({ expired: 2, failed: 1 });
		expect(service.expireOne).toHaveBeenCalledTimes(3);
	});

	it('reservation bị transaction khác khoá (expireOne=false) không tính là hết hạn', async () => {
		const service = {
			findExpiredIds: jest.fn().mockResolvedValue(['a']),
			expireOne: jest.fn().mockResolvedValue(false),
		};
		const { handler } = makeHandler(service);

		await expect(
			handler.execute(new ExpireReservationsCommand(0)),
		).resolves.toEqual({ expired: 0, failed: 0 });
	});

	it('batch đầy thì quét tiếp cho tới khi hết', async () => {
		const full = Array.from({ length: EXPIRY_BATCH_SIZE }, (_, i) => `r${i}`);
		const service = {
			findExpiredIds: jest
				.fn()
				.mockResolvedValueOnce(full)
				.mockResolvedValueOnce(['last']),
			expireOne: jest.fn().mockResolvedValue(true),
		};
		const { handler } = makeHandler(service);

		const result = await handler.execute(new ExpireReservationsCommand(0));

		expect(result.expired).toBe(EXPIRY_BATCH_SIZE + 1);
		expect(service.findExpiredIds).toHaveBeenCalledTimes(2);
	});

	it('batch có lỗi thì dừng, không quét lặp vô hạn', async () => {
		const full = Array.from({ length: EXPIRY_BATCH_SIZE }, (_, i) => `r${i}`);
		const service = {
			findExpiredIds: jest.fn().mockResolvedValue(full),
			expireOne: jest.fn().mockRejectedValue(new Error('x')),
		};
		const { handler } = makeHandler(service);

		const result = await handler.execute(new ExpireReservationsCommand(0));

		expect(result.failed).toBe(EXPIRY_BATCH_SIZE);
		expect(service.findExpiredIds).toHaveBeenCalledTimes(1);
	});
});
