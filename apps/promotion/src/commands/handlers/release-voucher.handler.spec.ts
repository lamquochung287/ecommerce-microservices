import { DataSource, EntityManager } from 'typeorm';
import { Voucher } from '../../entities/voucher.entity';
import {
	VoucherRedemption,
	VoucherRedemptionStatus,
} from '../../entities/voucher-redemption.entity';
import { ReleaseVoucherCommand } from '../release-voucher.command';
import { ReleaseVoucherHandler } from './release-voucher.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function setup(status: VoucherRedemptionStatus | null, usageCount = 1) {
	const voucher = { id: 'v1', usageCount } as Voucher;
	const redemption = (
		status ? { orderId: ORDER_ID, voucherId: 'v1', status } : null
	) as VoucherRedemption | null;
	const manager = {
		findOne: jest.fn((entity: unknown) =>
			Promise.resolve(entity === Voucher ? voucher : redemption),
		),
		save: jest.fn().mockResolvedValue(undefined),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: EntityManager) => unknown) =>
			cb(manager as unknown as EntityManager),
		),
	};
	const handler = new ReleaseVoucherHandler(
		dataSource as unknown as DataSource,
	);
	return { voucher, redemption, manager, dataSource, handler };
}

describe('ReleaseVoucherHandler', () => {
	it('RESERVED -> RELEASED và usageCount - 1 (TCP: tự mở transaction)', async () => {
		const { voucher, redemption, dataSource, handler } = setup(
			VoucherRedemptionStatus.RESERVED,
			2,
		);

		const result = await handler.execute(new ReleaseVoucherCommand(ORDER_ID));

		expect(result).toEqual({ released: true });
		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		expect(redemption?.status).toBe(VoucherRedemptionStatus.RELEASED);
		expect(voucher.usageCount).toBe(1);
	});

	it('có manager (Kafka): dùng manager đó, không mở transaction mới', async () => {
		const { redemption, manager, dataSource, handler } = setup(
			VoucherRedemptionStatus.RESERVED,
		);

		await handler.execute(
			new ReleaseVoucherCommand(ORDER_ID, manager as unknown as EntityManager),
		);

		expect(dataSource.transaction).not.toHaveBeenCalled();
		expect(redemption?.status).toBe(VoucherRedemptionStatus.RELEASED);
	});

	it.each([
		VoucherRedemptionStatus.CONFIRMED,
		VoucherRedemptionStatus.RELEASED,
	])('redemption %s: no-op, usageCount giữ nguyên', async (status) => {
		const { voucher, redemption, manager, handler } = setup(status, 3);

		const result = await handler.execute(new ReleaseVoucherCommand(ORDER_ID));

		expect(result).toEqual({ released: false });
		expect(redemption?.status).toBe(status);
		expect(voucher.usageCount).toBe(3);
		expect(manager.save).not.toHaveBeenCalled();
	});

	it('đơn không có voucher: no-op', async () => {
		const { manager, handler } = setup(null);

		await expect(
			handler.execute(new ReleaseVoucherCommand(ORDER_ID)),
		).resolves.toEqual({ released: false });
		expect(manager.save).not.toHaveBeenCalled();
	});

	it('usageCount không xuống dưới 0', async () => {
		const { voucher, handler } = setup(VoucherRedemptionStatus.RESERVED, 0);

		await handler.execute(new ReleaseVoucherCommand(ORDER_ID));

		expect(voucher.usageCount).toBe(0);
	});

	it('redemption đổi sang CONFIRMED giữa lần đọc đầu và lần đọc dưới khoá: no-op', async () => {
		const { voucher, manager, handler } = setup(
			VoucherRedemptionStatus.RESERVED,
			1,
		);
		const confirmed = {
			orderId: ORDER_ID,
			voucherId: 'v1',
			status: VoucherRedemptionStatus.CONFIRMED,
		} as VoucherRedemption;
		let redemptionReads = 0;
		manager.findOne.mockImplementation((entity: unknown) => {
			if (entity === Voucher) return Promise.resolve(voucher);
			redemptionReads += 1;
			return Promise.resolve(
				redemptionReads === 1
					? {
							...confirmed,
							status: VoucherRedemptionStatus.RESERVED,
						}
					: confirmed,
			);
		});

		const result = await handler.execute(new ReleaseVoucherCommand(ORDER_ID));

		expect(result).toEqual({ released: false });
		expect(voucher.usageCount).toBe(1);
		expect(manager.save).not.toHaveBeenCalled();
	});
});
