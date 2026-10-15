// mock.calls của jest.fn() có kiểu any.

import { EntityManager } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import { ShippingProvider } from '../../providers/shipping-provider.interface';
import { CreateShipmentCommand } from '../create-shipment.command';
import { CreateShipmentHandler } from './create-shipment.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PAYLOAD = {
	recipient: {
		recipientName: 'A',
		recipientPhone: '0900000000',
		addressLine1: '1 Main St',
		city: 'HCM',
		country: 'VN',
	},
	items: [{ productId: 'p1', quantity: 2 }],
};

function setup(existing: Partial<Shipment> | null = null) {
	const manager = {
		findOne: jest.fn().mockResolvedValue(existing),
		insert: jest.fn().mockResolvedValue(undefined),
	};
	const provider = {
		createShipment: jest
			.fn()
			.mockResolvedValue({ trackingCode: 'SIM-ABC', carrier: 'SIMULATED' }),
	};
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const handler = new CreateShipmentHandler(
		provider as unknown as ShippingProvider,
		outbox as unknown as OutboxWriter,
	);
	const run = (payload: unknown = PAYLOAD) =>
		handler.execute(
			new CreateShipmentCommand(
				manager as unknown as EntityManager,
				ORDER_ID,
				payload,
			),
		);
	return { manager, provider, outbox, run };
}

describe('CreateShipmentHandler', () => {
	it('tạo vận đơn CREATED và ghi outbox ShipmentCreated bằng cùng manager', async () => {
		const { manager, provider, outbox, run } = setup();

		await expect(run()).resolves.toEqual({ created: true });

		expect(provider.createShipment).toHaveBeenCalledWith(
			expect.objectContaining({ orderId: ORDER_ID, items: PAYLOAD.items }),
		);
		expect(manager.insert).toHaveBeenCalledWith(Shipment, {
			orderId: ORDER_ID,
			status: ShipmentStatus.CREATED,
			trackingCode: 'SIM-ABC',
			carrier: 'SIMULATED',
		});
		expect(outbox.append).toHaveBeenCalledWith(manager, {
			topic: KAFKA_TOPIC.SHIPPING_EVENTS,
			type: MESSAGE_TYPE.SHIPMENT_CREATED,
			orderId: ORDER_ID,
			payload: { trackingCode: 'SIM-ABC' },
		});
	});

	it.each([
		ShipmentStatus.CREATED,
		ShipmentStatus.FAILED,
		ShipmentStatus.CANCELLED,
		ShipmentStatus.DELIVERED,
	])('vận đơn đã có (%s): không gọi carrier, không ghi gì', async (status) => {
		const { manager, provider, outbox, run } = setup({ status });

		await expect(run()).resolves.toEqual({ created: false });

		expect(provider.createShipment).not.toHaveBeenCalled();
		expect(manager.insert).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('carrier lỗi: ném lỗi, không insert, không outbox', async () => {
		const { manager, provider, outbox, run } = setup();
		provider.createShipment.mockRejectedValue(new Error('carrier down'));

		await expect(run()).rejects.toThrow('carrier down');

		expect(manager.insert).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it.each([[null], [{ recipient: {}, items: [] }], [{ items: [{}] }]])(
		'payload sai hình dạng (%j): ném lỗi trước khi gọi carrier',
		async (payload) => {
			const { provider, run } = setup();

			await expect(run(payload)).rejects.toThrow('Invalid CreateShipment');

			expect(provider.createShipment).not.toHaveBeenCalled();
		},
	);
});
