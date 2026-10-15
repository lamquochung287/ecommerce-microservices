// mock.calls của jest.fn() có kiểu any.

import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { OutboxWriter } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import { SimulatedShippingProvider } from '../../providers/simulated-shipping.provider';
import { HandleShippingWebhookCommand } from '../handle-shipping-webhook.command';
import {
	HandleShippingWebhookHandler,
	SHIPPING_WEBHOOK_CONSUMER,
} from './handle-shipping-webhook.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERED_AT = '2026-10-15T10:00:00.000Z';

// Dùng provider mô phỏng thật để HMAC được kiểm bằng đúng thuật toán sản xuất.
const provider = new SimulatedShippingProvider({
	getOrThrow: () => 'test-secret',
	get: () => undefined,
} as unknown as ConfigService);

const payload = (overrides: Record<string, unknown> = {}) => ({
	eventId: 'ship-1:delivered',
	orderId: ORDER_ID,
	trackingCode: 'SIM-1',
	status: 'DELIVERED',
	deliveredAt: DELIVERED_AT,
	...overrides,
});

function setup(
	shipment: Partial<Shipment> | null = {
		id: 'ship-1',
		orderId: ORDER_ID,
		status: ShipmentStatus.CREATED,
		trackingCode: 'SIM-1',
	},
	acquired = true,
) {
	const manager = {
		findOne: jest.fn().mockResolvedValue(shipment),
		update: jest.fn().mockResolvedValue(undefined),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
	};
	const inbox = { tryAcquire: jest.fn().mockResolvedValue(acquired) };
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const handler = new HandleShippingWebhookHandler(
		dataSource as unknown as DataSource,
		provider,
		inbox,
		outbox as unknown as OutboxWriter,
	);
	const run = (body: Record<string, unknown>, signature?: string) =>
		handler.execute(
			new HandleShippingWebhookCommand({
				payload: body,
				signature: signature ?? provider.signWebhook(body),
			}),
		);
	return { manager, dataSource, inbox, outbox, run };
}

describe('HandleShippingWebhookHandler', () => {
	it('chữ ký sai: 400 và không mở transaction, không inbox, không outbox', async () => {
		const { dataSource, inbox, outbox, run } = setup();

		await expect(run(payload(), 'bad-signature')).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
		// chữ ký đúng độ dài nhưng sai nội dung
		await expect(run(payload(), 'a'.repeat(64))).rejects.toMatchObject({
			error: { statusCode: 400 },
		});

		expect(dataSource.transaction).not.toHaveBeenCalled();
		expect(inbox.tryAcquire).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('payload bị sửa sau khi ký: 400', async () => {
		const { run } = setup();
		const signature = provider.signWebhook(payload());

		await expect(
			run(payload({ trackingCode: 'SIM-OTHER' }), signature),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
	});

	it('eventId trùng: alreadyProcessed, không đụng shipment/outbox', async () => {
		const { manager, outbox, run } = setup(undefined, false);

		await expect(run(payload())).resolves.toEqual({
			processed: false,
			alreadyProcessed: true,
		});

		expect(manager.findOne).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('CREATED -> DELIVERED, ghi deliveredAt và outbox ShipmentDelivered cùng manager', async () => {
		const { manager, inbox, outbox, run } = setup();

		await expect(run(payload())).resolves.toEqual({
			processed: true,
			alreadyProcessed: false,
		});

		expect(inbox.tryAcquire).toHaveBeenCalledWith(
			manager,
			SHIPPING_WEBHOOK_CONSUMER,
			'ship-1:delivered',
		);
		expect(manager.update).toHaveBeenCalledWith(Shipment, 'ship-1', {
			status: ShipmentStatus.DELIVERED,
			deliveredAt: new Date(DELIVERED_AT),
		});
		expect(outbox.append).toHaveBeenCalledWith(manager, {
			topic: KAFKA_TOPIC.SHIPPING_EVENTS,
			type: MESSAGE_TYPE.SHIPMENT_DELIVERED,
			orderId: ORDER_ID,
			payload: { deliveredAt: DELIVERED_AT },
		});
	});

	it.each([
		ShipmentStatus.DELIVERED,
		ShipmentStatus.CANCELLED,
		ShipmentStatus.FAILED,
	])('shipment %s: no-op, không phát event', async (status) => {
		const { manager, outbox, run } = setup({
			id: 'ship-1',
			orderId: ORDER_ID,
			status,
			trackingCode: 'SIM-1',
		});

		await expect(run(payload())).resolves.toEqual({
			processed: true,
			alreadyProcessed: false,
		});

		expect(manager.update).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('không có shipment: 404 (rollback nên inbox không bị giữ)', async () => {
		const { run } = setup(null);

		await expect(run(payload())).rejects.toMatchObject({
			error: { statusCode: 404 },
		});
	});

	it('trackingCode không khớp shipment: 400', async () => {
		const { manager, outbox, run } = setup();

		await expect(
			run(payload({ trackingCode: 'SIM-OTHER' })),
		).rejects.toMatchObject({ error: { statusCode: 400 } });

		expect(manager.update).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it.each([
		['orderId không phải UUID', { orderId: 'x' }],
		['status khác DELIVERED', { status: 'LOST' }],
		['deliveredAt không phải ISO', { deliveredAt: 'yesterday' }],
		['thiếu eventId', { eventId: '' }],
		['thiếu trackingCode', { trackingCode: undefined }],
	])('payload đã ký nhưng sai schema (%s): 400', async (_name, override) => {
		const { dataSource, run } = setup();

		await expect(run(payload(override))).rejects.toMatchObject({
			error: { statusCode: 400 },
		});

		expect(dataSource.transaction).not.toHaveBeenCalled();
	});
});
