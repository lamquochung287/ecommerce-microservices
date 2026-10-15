// jest.fn() giả service: so sánh lời gọi qua method tham chiếu là chủ ý.
/* eslint-disable @typescript-eslint/unbound-method */
import { EntityManager } from 'typeorm';
import { createMockDataSource } from '../../../test/mock-manager';
import { ReservationService } from '../../domain/reservation.service';
import { ReserveStockDto } from '../../dto/inventory.dto';
import { ReservationStatus } from '../../entities/reservation.entity';
import { ReleaseReservationCommand } from '../release-reservation.command';
import { ReserveStockCommand } from '../reserve-stock.command';
import { ReleaseReservationHandler } from './release-reservation.handler';
import { ReserveStockHandler } from './reserve-stock.handler';

const dto: ReserveStockDto = {
	orderId: '11111111-1111-4111-8111-111111111111',
	items: [],
	ttlSeconds: 900,
};

describe('ReserveStockHandler', () => {
	it('chạy reserve trong đúng transaction của DataSource', async () => {
		const manager = {} as EntityManager;
		const dataSource = createMockDataSource(manager);
		const result = {
			orderId: dto.orderId,
			status: ReservationStatus.RESERVED as const,
			expiresAt: new Date(),
		};
		const service = {
			reserve: jest.fn().mockResolvedValue(result),
		} as unknown as ReservationService;
		const handler = new ReserveStockHandler(dataSource as never, service);

		await expect(handler.execute(new ReserveStockCommand(dto))).resolves.toBe(
			result,
		);

		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		expect(service.reserve).toHaveBeenCalledWith(manager, dto);
	});

	it('lỗi từ service làm transaction lỗi (không nuốt)', async () => {
		const dataSource = createMockDataSource({} as EntityManager);
		const service = {
			reserve: jest.fn().mockRejectedValue(new Error('boom')),
		} as unknown as ReservationService;
		const handler = new ReserveStockHandler(dataSource as never, service);

		await expect(handler.execute(new ReserveStockCommand(dto))).rejects.toThrow(
			'boom',
		);
	});
});

describe('ReleaseReservationHandler', () => {
	it('release trong transaction', async () => {
		const manager = {} as EntityManager;
		const dataSource = createMockDataSource(manager);
		const service = {
			release: jest.fn().mockResolvedValue({ released: true }),
		} as unknown as ReservationService;
		const handler = new ReleaseReservationHandler(dataSource as never, service);

		await expect(
			handler.execute(new ReleaseReservationCommand(dto.orderId)),
		).resolves.toEqual({ released: true });

		expect(service.release).toHaveBeenCalledWith(manager, dto.orderId);
	});
});
