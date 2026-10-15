import {
	SQL,
	createMockDataSource,
	createMockManager,
} from '../../../test/mock-manager';
import { ReservationService } from '../../domain/reservation.service';
import { ReservationStatus } from '../../entities/reservation.entity';
import { CheckReservationQuery } from '../check-reservation.query';
import { CheckReservationHandler } from './check-reservation.handler';

const ORDER = '11111111-1111-4111-8111-111111111111';

function run(row: { status: ReservationStatus; expiresAt: Date } | null) {
	const { manager } = createMockManager([
		[
			SQL.findReservation,
			() => (row ? [{ id: 'r1', orderId: ORDER, items: [], ...row }] : []),
		],
	]);
	const handler = new CheckReservationHandler(
		createMockDataSource(manager) as never,
		new ReservationService(),
	);
	return handler.execute(new CheckReservationQuery(ORDER));
}

describe('CheckReservationHandler', () => {
	it('RESERVED chưa hết hạn: valid', async () => {
		const expiresAt = new Date(Date.now() + 60_000);
		await expect(
			run({ status: ReservationStatus.RESERVED, expiresAt }),
		).resolves.toEqual({ valid: true, status: 'RESERVED', expiresAt });
	});

	it('RESERVED quá hạn: không valid', async () => {
		await expect(
			run({
				status: ReservationStatus.RESERVED,
				expiresAt: new Date(Date.now() - 1000),
			}),
		).resolves.toMatchObject({ valid: false, status: 'RESERVED' });
	});

	it.each([
		ReservationStatus.RELEASED,
		ReservationStatus.EXPIRED,
		ReservationStatus.COMMITTED,
	])('%s: không valid dù expiresAt còn xa', async (status) => {
		await expect(
			run({ status, expiresAt: new Date(Date.now() + 60_000) }),
		).resolves.toMatchObject({ valid: false, status });
	});

	it('không có reservation: NOT_FOUND', async () => {
		await expect(run(null)).resolves.toEqual({
			valid: false,
			status: 'NOT_FOUND',
			expiresAt: null,
		});
	});

	it('chỉ đọc: không khoá, không ghi', async () => {
		const { manager, calls } = createMockManager([]);
		const handler = new CheckReservationHandler(
			createMockDataSource(manager) as never,
			new ReservationService(),
		);

		await handler.execute(new CheckReservationQuery(ORDER));

		expect(calls).toHaveLength(1);
		expect(calls[0].sql).not.toMatch(/FOR UPDATE/);
	});
});
