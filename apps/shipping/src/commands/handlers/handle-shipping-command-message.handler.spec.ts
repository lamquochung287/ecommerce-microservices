// mock.calls của jest.fn() có kiểu any.
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource, EntityManager } from 'typeorm';
import {
	InboxService,
	KafkaConsumerRunner,
	KafkaProducerService,
	OutboxWriter,
	createEnvelope,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
	dlqTopic,
} from 'libs/constant/kafka.constant';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import { ShippingProvider } from '../../providers/shipping-provider.interface';
import { DeliveryTimerService } from '../../simulator/delivery-timer.service';
import { CancelShipmentCommand } from '../cancel-shipment.command';
import { CreateShipmentCommand } from '../create-shipment.command';
import { HandleShippingCommandMessage } from '../handle-shipping-command-message.command';
import { CancelShipmentHandler } from './cancel-shipment.handler';
import { CreateShipmentHandler } from './create-shipment.handler';
import { HandleShippingCommandMessageHandler } from './handle-shipping-command-message.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PAYLOAD = {
	recipient: {
		recipientName: 'A',
		recipientPhone: '0900000000',
		addressLine1: '1 Main St',
		city: 'HCM',
		country: 'VN',
	},
	items: [{ productId: 'p1', quantity: 1 }],
};

/**
 * Ghép runner thật (inbox + retry + DLQ) với handler thật; chỉ mock DB/Kafka/carrier.
 * `shipments` mô phỏng bảng: insert đẩy vào, rollback KHÔNG được mô phỏng nên test chỉ kiểm hành vi quan sát được.
 */
function setup(maxAttempts = 3) {
	const stored: Partial<Shipment>[] = [];
	const manager = {
		findOne: jest.fn(() => Promise.resolve(stored[0] ?? null)),
		insert: jest.fn((_entity: unknown, row: Partial<Shipment>) => {
			stored.push(row);
			return Promise.resolve();
		}),
		update: jest.fn().mockResolvedValue(undefined),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: EntityManager) => unknown) =>
			cb(manager as unknown as EntityManager),
		),
	};
	const inbox = { tryAcquire: jest.fn().mockResolvedValue(true) };
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const provider = {
		createShipment: jest
			.fn()
			.mockResolvedValue({ trackingCode: 'SIM-OK', carrier: 'SIMULATED' }),
		cancelShipment: jest.fn().mockResolvedValue(undefined),
	};
	const timer = { schedule: jest.fn() };

	const config = {
		get: (key: string, fallback: unknown) =>
			key === 'KAFKA_CONSUMER_MAX_ATTEMPTS'
				? maxAttempts
				: key === 'KAFKA_CONSUMER_RETRY_BACKOFF_MS'
					? 0
					: fallback,
	} as unknown as ConfigService;
	const runner = new KafkaConsumerRunner(
		dataSource as unknown as DataSource,
		inbox,
		producer as unknown as KafkaProducerService,
		config,
	);

	const createHandler = new CreateShipmentHandler(
		provider as unknown as ShippingProvider,
		outbox as unknown as OutboxWriter,
	);
	const cancelHandler = new CancelShipmentHandler(
		provider as unknown as ShippingProvider,
	);
	const commandBus = {
		execute: jest.fn((cmd: unknown) =>
			cmd instanceof CreateShipmentCommand
				? createHandler.execute(cmd)
				: cmd instanceof CancelShipmentCommand
					? cancelHandler.execute(cmd)
					: Promise.reject(new Error('unexpected command')),
		),
	};
	const handler = new HandleShippingCommandMessageHandler(
		runner,
		commandBus as unknown as CommandBus,
		timer as unknown as DeliveryTimerService,
		inbox,
		outbox as unknown as OutboxWriter,
		dataSource as unknown as DataSource,
	);
	const send = (type: string, payload: unknown = PAYLOAD) =>
		handler.execute(
			new HandleShippingCommandMessage(
				createEnvelope({ type, orderId: ORDER_ID, payload }),
				KAFKA_TOPIC.SHIPPING_COMMANDS,
			),
		);
	return { stored, manager, inbox, producer, outbox, provider, timer, send };
}

describe('HandleShippingCommandMessageHandler', () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it('CreateShipment thành công: CREATED + ShipmentCreated, không DLQ, hẹn giờ giao sau commit', async () => {
		const { stored, outbox, producer, timer, send } = setup();

		await send(MESSAGE_TYPE.CREATE_SHIPMENT);

		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({ status: ShipmentStatus.CREATED });
		expect(outbox.append).toHaveBeenCalledTimes(1);
		expect(outbox.append.mock.calls[0][1]).toMatchObject({
			type: MESSAGE_TYPE.SHIPMENT_CREATED,
		});
		expect(producer.send).not.toHaveBeenCalled();
		expect(timer.schedule).toHaveBeenCalledWith(ORDER_ID);
	});

	it('carrier lỗi 2 lần rồi OK: CREATED, không DLQ, không ShipmentFailed', async () => {
		const { stored, provider, outbox, producer, send } = setup();
		provider.createShipment
			.mockRejectedValueOnce(new Error('timeout'))
			.mockRejectedValueOnce(new Error('timeout'));

		await send(MESSAGE_TYPE.CREATE_SHIPMENT);

		expect(provider.createShipment).toHaveBeenCalledTimes(3);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({ status: ShipmentStatus.CREATED });
		expect(producer.send).not.toHaveBeenCalled();
		expect(
			(outbox.append.mock.calls as [unknown, { type: string }][]).map(
				(c) => c[1].type,
			),
		).toEqual([MESSAGE_TYPE.SHIPMENT_CREATED]);
	});

	it('carrier lỗi 3 lần: DLQ đúng 1 lần, vận đơn FAILED, outbox ShipmentFailed, không hẹn giờ giao', async () => {
		const { stored, provider, outbox, producer, inbox, timer, send } = setup();
		provider.createShipment.mockRejectedValue(new Error('carrier down'));

		await send(MESSAGE_TYPE.CREATE_SHIPMENT);

		expect(provider.createShipment).toHaveBeenCalledTimes(3);
		expect(producer.send).toHaveBeenCalledTimes(1);
		expect(producer.send.mock.calls[0][0]).toBe(
			dlqTopic(KAFKA_TOPIC.SHIPPING_COMMANDS),
		);
		expect(producer.send.mock.calls[0][0]).toBe('shipping-commands.dlq');
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			orderId: ORDER_ID,
			status: ShipmentStatus.FAILED,
			failureReason: 'carrier down',
		});
		expect(outbox.append).toHaveBeenCalledTimes(1);
		expect(outbox.append.mock.calls[0][1]).toEqual({
			topic: KAFKA_TOPIC.SHIPPING_EVENTS,
			type: MESSAGE_TYPE.SHIPMENT_FAILED,
			orderId: ORDER_ID,
			payload: { reason: 'carrier down' },
		});
		// 3 lần thử + 1 lần đánh dấu inbox của nhánh hết lượt
		expect(inbox.tryAcquire).toHaveBeenCalledTimes(4);
		expect(inbox.tryAcquire.mock.calls[3][1]).toBe(CONSUMER_GROUP.SHIPPING);
		expect(timer.schedule).not.toHaveBeenCalled();
	});

	it('hết lượt nhưng message đã được xử lý trước đó (inbox trùng): không phát ShipmentFailed lần nữa', async () => {
		const { provider, outbox, inbox, send } = setup();
		provider.createShipment.mockRejectedValue(new Error('carrier down'));
		// 3 lần thử: inbox cho qua; lần đánh dấu cuối: đã có
		inbox.tryAcquire
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await send(MESSAGE_TYPE.CREATE_SHIPMENT);

		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('CreateShipment lặp (vận đơn đã có): carrier không được gọi lại, không hẹn giờ', async () => {
		const { provider, timer, send } = setup();

		await send(MESSAGE_TYPE.CREATE_SHIPMENT);
		await send(MESSAGE_TYPE.CREATE_SHIPMENT);

		expect(provider.createShipment).toHaveBeenCalledTimes(1);
		expect(timer.schedule).toHaveBeenCalledTimes(1);
	});

	it('CancelShipment đi qua CancelShipmentHandler; lỗi của lệnh huỷ không tạo ShipmentFailed', async () => {
		const { stored, provider, outbox, producer, send } = setup();
		stored.push({
			id: 's1',
			orderId: ORDER_ID,
			status: ShipmentStatus.CREATED,
			trackingCode: 'SIM-1',
		});
		provider.cancelShipment.mockRejectedValue(new Error('carrier down'));

		await send(MESSAGE_TYPE.CANCEL_SHIPMENT, {});

		expect(provider.cancelShipment).toHaveBeenCalledTimes(3);
		expect(producer.send).toHaveBeenCalledTimes(1);
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('type lạ: chỉ log, không DLQ, không gọi carrier', async () => {
		const { provider, producer, outbox, send } = setup();

		await send('SomethingElse', {});

		expect(provider.createShipment).not.toHaveBeenCalled();
		expect(producer.send).not.toHaveBeenCalled();
		expect(outbox.append).not.toHaveBeenCalled();
	});

	it('envelope không hợp lệ: vào DLQ, không xử lý', async () => {
		const { producer, provider, manager } = setup();
		const handler = new HandleShippingCommandMessageHandler(
			new KafkaConsumerRunner(
				{ transaction: jest.fn() } as unknown as DataSource,
				{} as InboxService,
				producer as unknown as KafkaProducerService,
				{ get: (_k: string, f: unknown) => f } as unknown as ConfigService,
			),
			{ execute: jest.fn() } as unknown as CommandBus,
			{ schedule: jest.fn() } as unknown as DeliveryTimerService,
			{} as InboxService,
			{} as OutboxWriter,
			{ transaction: jest.fn() } as unknown as DataSource,
		);

		await handler.execute(
			new HandleShippingCommandMessage(
				{ nonsense: true },
				KAFKA_TOPIC.SHIPPING_COMMANDS,
			),
		);

		expect(producer.send).toHaveBeenCalledTimes(1);
		expect(provider.createShipment).not.toHaveBeenCalled();
		expect(manager.insert).not.toHaveBeenCalled();
	});
});
