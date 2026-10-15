// Raw query và jest.fn() trả any theo thiết kế.

import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource } from 'typeorm';
import {
	InboxService,
	KafkaConsumerRunner,
	KafkaProducerService,
	OutboxWriter,
	createEnvelope,
} from '@lib/messaging';
import {
	KAFKA_TOPIC,
	MESSAGE_TYPE,
	OUTBOX_SOURCE,
} from 'libs/constant/kafka.constant';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { CancelShipmentCommand } from '../src/commands/cancel-shipment.command';
import { CreateShipmentCommand } from '../src/commands/create-shipment.command';
import { CancelShipmentHandler } from '../src/commands/handlers/cancel-shipment.handler';
import { CreateShipmentHandler } from '../src/commands/handlers/create-shipment.handler';
import { simulatedDeliveryEventId } from '../src/commands/handlers/simulate-delivery.handler';
import { HandleShippingCommandMessageHandler } from '../src/commands/handlers/handle-shipping-command-message.handler';
import { HandleShippingWebhookHandler } from '../src/commands/handlers/handle-shipping-webhook.handler';
import { HandleShippingCommandMessage } from '../src/commands/handle-shipping-command-message.command';
import { HandleShippingWebhookCommand } from '../src/commands/handle-shipping-webhook.command';
import { SimulatedShippingProvider } from '../src/providers/simulated-shipping.provider';
import { DeliveryTimerService } from '../src/simulator/delivery-timer.service';

const PAYLOAD = {
	recipient: {
		recipientName: 'A',
		recipientPhone: '0900000000',
		addressLine1: '1 Main St',
		city: 'HCM',
		country: 'VN',
	},
	items: [{ productId: randomUUID(), quantity: 1 }],
};

function build(ds: DataSource, simMode: 'success' | 'fail') {
	const values: Record<string, unknown> = {
		SHIPPING_SIM_MODE: simMode,
		SHIPPING_WEBHOOK_SECRET: 'int-test-secret',
		KAFKA_CONSUMER_RETRY_BACKOFF_MS: 0,
	};
	const config = {
		get: (key: string, fallback: unknown) => values[key] ?? fallback,
		getOrThrow: (key: string) => values[key],
	} as unknown as ConfigService;
	const provider = new SimulatedShippingProvider(config);
	const inbox = new InboxService();
	const outbox = new OutboxWriter({ source: OUTBOX_SOURCE.SHIPPING });
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const runner = new KafkaConsumerRunner(
		ds,
		inbox,
		producer as unknown as KafkaProducerService,
		config,
	);
	const createHandler = new CreateShipmentHandler(provider, outbox);
	const cancelHandler = new CancelShipmentHandler(provider);
	const commandBus = {
		execute: (cmd: unknown) =>
			cmd instanceof CreateShipmentCommand
				? createHandler.execute(cmd)
				: cancelHandler.execute(cmd as CancelShipmentCommand),
	};
	const handler = new HandleShippingCommandMessageHandler(
		runner,
		commandBus as unknown as CommandBus,
		{ schedule: jest.fn() } as unknown as DeliveryTimerService,
		inbox,
		outbox,
		ds,
	);
	const webhook = new HandleShippingWebhookHandler(ds, provider, inbox, outbox);
	const send = (type: string, orderId: string, payload: unknown = PAYLOAD) =>
		handler.execute(
			new HandleShippingCommandMessage(
				createEnvelope({ type, orderId, payload }),
				KAFKA_TOPIC.SHIPPING_COMMANDS,
			),
		);
	return { provider, producer, webhook, send };
}

async function shipmentOf(ds: DataSource, orderId: string) {
	const rows: { id: string; status: string; trackingCode: string | null }[] =
		await ds.query(
			`SELECT "id", "status", "trackingCode" FROM "shipments" WHERE "orderId" = $1`,
			[orderId],
		);
	return rows[0];
}

async function outboxTypes(ds: DataSource, orderId: string) {
	const rows: { eventType: string; topic: string; source: string }[] =
		await ds.query(
			`SELECT "eventType", "topic", "source" FROM "outbox" WHERE "key" = $1 ORDER BY "seq"`,
			[orderId],
		);
	return rows;
}

async function cleanup(ds: DataSource, orderId: string) {
	const shipment = await shipmentOf(ds, orderId);
	await ds.query(`DELETE FROM "outbox" WHERE "key" = $1`, [orderId]);
	if (shipment) {
		await ds.query(
			`DELETE FROM "processed_messages" WHERE "consumer" = 'shipping-webhook' AND "eventId" = $1`,
			[simulatedDeliveryEventId(shipment.id)],
		);
	}
	await ds.query(`DELETE FROM "shipments" WHERE "orderId" = $1`, [orderId]);
}

describeWithDb('Shipping (Postgres)', ({ it }) => {
	it('CreateShipment ghi vận đơn CREATED và outbox ShipmentCreated (source shipping, topic shipping-events)', async (ds) => {
		const orderId = randomUUID();
		const { send } = build(ds, 'success');
		try {
			await send(MESSAGE_TYPE.CREATE_SHIPMENT, orderId);

			const shipment = await shipmentOf(ds, orderId);
			expect(shipment.status).toBe('CREATED');
			expect(shipment.trackingCode).toMatch(/^SIM-/);
			expect(await outboxTypes(ds, orderId)).toEqual([
				{
					eventType: MESSAGE_TYPE.SHIPMENT_CREATED,
					topic: KAFKA_TOPIC.SHIPPING_EVENTS,
					source: OUTBOX_SOURCE.SHIPPING,
				},
			]);
		} finally {
			await cleanup(ds, orderId);
		}
	});

	it('carrier lỗi 3 lần: shipment FAILED + ShipmentFailed trong outbox thật, DLQ gửi 1 lần', async (ds) => {
		const orderId = randomUUID();
		const { send, producer } = build(ds, 'fail');
		try {
			await send(MESSAGE_TYPE.CREATE_SHIPMENT, orderId);

			expect((await shipmentOf(ds, orderId)).status).toBe('FAILED');
			expect((await outboxTypes(ds, orderId)).map((r) => r.eventType)).toEqual([
				MESSAGE_TYPE.SHIPMENT_FAILED,
			]);
			expect(producer.send).toHaveBeenCalledTimes(1);
		} finally {
			await cleanup(ds, orderId);
		}
	});

	it('webhook giao hàng: CREATED -> DELIVERED + ShipmentDelivered; gửi lại cùng eventId là alreadyProcessed', async (ds) => {
		const orderId = randomUUID();
		const { send, provider, webhook } = build(ds, 'success');
		try {
			await send(MESSAGE_TYPE.CREATE_SHIPMENT, orderId);
			const { id, trackingCode } = await shipmentOf(ds, orderId);
			const payload = {
				eventId: simulatedDeliveryEventId(id),
				orderId,
				trackingCode,
				status: 'DELIVERED',
				deliveredAt: new Date().toISOString(),
			};
			const command = new HandleShippingWebhookCommand({
				payload,
				signature: provider.signWebhook(payload),
			});

			await expect(webhook.execute(command)).resolves.toEqual({
				processed: true,
				alreadyProcessed: false,
			});
			await expect(webhook.execute(command)).resolves.toEqual({
				processed: false,
				alreadyProcessed: true,
			});

			expect((await shipmentOf(ds, orderId)).status).toBe('DELIVERED');
			expect((await outboxTypes(ds, orderId)).map((r) => r.eventType)).toEqual([
				MESSAGE_TYPE.SHIPMENT_CREATED,
				MESSAGE_TYPE.SHIPMENT_DELIVERED,
			]);
		} finally {
			await cleanup(ds, orderId);
		}
	});

	it('CancelShipment: CREATED -> CANCELLED; webhook giao tới sau đó là no-op (không ShipmentDelivered)', async (ds) => {
		const orderId = randomUUID();
		const { send, provider, webhook } = build(ds, 'success');
		try {
			await send(MESSAGE_TYPE.CREATE_SHIPMENT, orderId);
			await send(MESSAGE_TYPE.CANCEL_SHIPMENT, orderId, {});
			expect((await shipmentOf(ds, orderId)).status).toBe('CANCELLED');

			const { id, trackingCode } = await shipmentOf(ds, orderId);
			const payload = {
				eventId: simulatedDeliveryEventId(id),
				orderId,
				trackingCode,
				status: 'DELIVERED',
				deliveredAt: new Date().toISOString(),
			};
			await webhook.execute(
				new HandleShippingWebhookCommand({
					payload,
					signature: provider.signWebhook(payload),
				}),
			);

			expect((await shipmentOf(ds, orderId)).status).toBe('CANCELLED');
			expect((await outboxTypes(ds, orderId)).map((r) => r.eventType)).toEqual([
				MESSAGE_TYPE.SHIPMENT_CREATED,
			]);
		} finally {
			await cleanup(ds, orderId);
		}
	});

	it('hai CreateShipment song song cùng đơn: đúng một vận đơn và một ShipmentCreated', async (ds) => {
		const orderId = randomUUID();
		const { send } = build(ds, 'success');
		try {
			await Promise.all([
				send(MESSAGE_TYPE.CREATE_SHIPMENT, orderId),
				send(MESSAGE_TYPE.CREATE_SHIPMENT, orderId),
			]);

			const rows: { count: string }[] = await ds.query(
				`SELECT count(*) FROM "shipments" WHERE "orderId" = $1`,
				[orderId],
			);
			expect(rows[0].count).toBe('1');
			expect(
				(await outboxTypes(ds, orderId)).filter(
					(r) => r.eventType === MESSAGE_TYPE.SHIPMENT_CREATED,
				),
			).toHaveLength(1);
		} finally {
			await cleanup(ds, orderId);
		}
	});
});
