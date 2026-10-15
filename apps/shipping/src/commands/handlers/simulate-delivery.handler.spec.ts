// mock.calls của jest.fn() có kiểu any.
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { Repository } from 'typeorm';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import { SimulatedShippingProvider } from '../../providers/simulated-shipping.provider';
import { HandleShippingWebhookCommand } from '../handle-shipping-webhook.command';
import { SimulateDeliveryCommand } from '../simulate-delivery.command';
import {
	SimulateDeliveryHandler,
	simulatedDeliveryEventId,
} from './simulate-delivery.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const config = (nodeEnv?: string) =>
	({
		getOrThrow: () => 'test-secret',
		get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
	}) as unknown as ConfigService;

function setup(
	nodeEnv: string | undefined,
	shipment: Partial<Shipment> | null = {
		id: 'ship-1',
		orderId: ORDER_ID,
		status: ShipmentStatus.CREATED,
		trackingCode: 'SIM-1',
	},
) {
	const cfg = config(nodeEnv);
	const provider = new SimulatedShippingProvider(cfg);
	const repo = { findOne: jest.fn().mockResolvedValue(shipment) };
	const commandBus = {
		execute: jest.fn().mockResolvedValue({ processed: true }),
	};
	const handler = new SimulateDeliveryHandler(
		repo as unknown as Repository<Shipment>,
		provider,
		cfg,
		commandBus as unknown as CommandBus,
	);
	return { provider, repo, commandBus, handler };
}

describe('SimulateDeliveryHandler', () => {
	it('production: 404 và không đụng DB hay webhook', async () => {
		const { repo, commandBus, handler } = setup('production');

		await expect(
			handler.execute(new SimulateDeliveryCommand(ORDER_ID)),
		).rejects.toMatchObject({ error: { statusCode: 404 } });

		expect(repo.findOne).not.toHaveBeenCalled();
		expect(commandBus.execute).not.toHaveBeenCalled();
	});

	it('không phải production: dựng webhook đã ký và chạy qua HandleShippingWebhook (đường verify thật)', async () => {
		const { provider, commandBus, handler } = setup('development');

		await expect(
			handler.execute(new SimulateDeliveryCommand(ORDER_ID)),
		).resolves.toEqual({ processed: true });

		const command = commandBus.execute.mock.calls[0][0];
		expect(command).toBeInstanceOf(HandleShippingWebhookCommand);
		const { payload, signature } = (command as HandleShippingWebhookCommand)
			.dto;
		expect(payload).toMatchObject({
			eventId: simulatedDeliveryEventId('ship-1'),
			orderId: ORDER_ID,
			trackingCode: 'SIM-1',
			status: 'DELIVERED',
		});
		expect(payload.eventId).toMatch(UUID_PATTERN);
		expect(provider.verifyWebhook(payload, signature)).toBe(true);
	});

	it('eventId tất định theo vận đơn: gọi lại cùng vận đơn cho cùng eventId', async () => {
		const first = setup('development');
		const second = setup('development');

		await first.handler.execute(new SimulateDeliveryCommand(ORDER_ID));
		await second.handler.execute(new SimulateDeliveryCommand(ORDER_ID));

		expect(first.commandBus.execute.mock.calls[0][0].dto.payload.eventId).toBe(
			second.commandBus.execute.mock.calls[0][0].dto.payload.eventId,
		);
	});

	it('không có vận đơn: 404', async () => {
		const { commandBus, handler } = setup('development', null);

		await expect(
			handler.execute(new SimulateDeliveryCommand(ORDER_ID)),
		).rejects.toMatchObject({ error: { statusCode: 404 } });

		expect(commandBus.execute).not.toHaveBeenCalled();
	});

	it('vận đơn FAILED không có trackingCode: 409', async () => {
		const { commandBus, handler } = setup('development', {
			id: 'ship-1',
			orderId: ORDER_ID,
			status: ShipmentStatus.FAILED,
			trackingCode: null,
		});

		await expect(
			handler.execute(new SimulateDeliveryCommand(ORDER_ID)),
		).rejects.toMatchObject({ error: { statusCode: 409 } });

		expect(commandBus.execute).not.toHaveBeenCalled();
	});
});
