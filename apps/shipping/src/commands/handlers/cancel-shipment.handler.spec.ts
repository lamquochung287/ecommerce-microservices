// mock.calls của jest.fn() có kiểu any.

import { EntityManager } from 'typeorm';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import { ShippingProvider } from '../../providers/shipping-provider.interface';
import { CancelShipmentCommand } from '../cancel-shipment.command';
import { CancelShipmentHandler } from './cancel-shipment.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function setup(shipment: Partial<Shipment> | null) {
	const manager = {
		findOne: jest.fn().mockResolvedValue(shipment),
		update: jest.fn().mockResolvedValue(undefined),
	};
	const provider = { cancelShipment: jest.fn().mockResolvedValue(undefined) };
	const handler = new CancelShipmentHandler(
		provider as unknown as ShippingProvider,
	);
	const run = () =>
		handler.execute(
			new CancelShipmentCommand(manager as unknown as EntityManager, ORDER_ID),
		);
	return { manager, provider, run };
}

describe('CancelShipmentHandler', () => {
	it('CREATED: huỷ ở carrier và chuyển CANCELLED, khoá dòng khi đọc', async () => {
		const { manager, provider, run } = setup({
			id: 's1',
			status: ShipmentStatus.CREATED,
			trackingCode: 'SIM-1',
		});

		await run();

		expect(manager.findOne).toHaveBeenCalledWith(
			Shipment,
			expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
		);
		expect(provider.cancelShipment).toHaveBeenCalledWith('SIM-1');
		expect(manager.update).toHaveBeenCalledWith(Shipment, 's1', {
			status: ShipmentStatus.CANCELLED,
		});
	});

	it('không có vận đơn: no-op', async () => {
		const { manager, provider, run } = setup(null);

		await run();

		expect(provider.cancelShipment).not.toHaveBeenCalled();
		expect(manager.update).not.toHaveBeenCalled();
	});

	it.each([
		ShipmentStatus.FAILED,
		ShipmentStatus.CANCELLED,
		ShipmentStatus.DELIVERED,
	])('%s: không đổi gì, không gọi carrier', async (status) => {
		const { manager, provider, run } = setup({
			id: 's1',
			status,
			trackingCode: 'SIM-1',
		});

		await run();

		expect(provider.cancelShipment).not.toHaveBeenCalled();
		expect(manager.update).not.toHaveBeenCalled();
	});

	it('carrier huỷ lỗi: ném lỗi và không đổi trạng thái', async () => {
		const { manager, provider, run } = setup({
			id: 's1',
			status: ShipmentStatus.CREATED,
			trackingCode: 'SIM-1',
		});
		provider.cancelShipment.mockRejectedValue(new Error('carrier down'));

		await expect(run()).rejects.toThrow('carrier down');

		expect(manager.update).not.toHaveBeenCalled();
	});
});
