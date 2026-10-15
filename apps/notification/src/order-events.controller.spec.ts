// Mock trả Promise theo chữ ký dependency thật; payload thử nghiệm là object tự dựng.
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-member-access */
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import {
	KafkaConsumerRunner,
	KafkaProducerService,
	createEnvelope,
} from '@lib/messaging';
import { MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import {
	NotificationChannel,
	NotificationStatus,
	SentNotification,
} from './entities/sent-notification.entity';
import { buildOrderEventEmail } from './order-event-message';
import { OrderEventsController } from './order-events.controller';

function build(options: { userClient?: Partial<ClientProxy> } = {}) {
	const manager = {
		create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
		save: jest.fn(async (row: unknown) => row),
	};
	// Inbox giả lập đúng hợp đồng: lần đầu cho phép, cùng eventId lần sau trả false;
	// transaction lỗi thì rollback luôn dòng inbox đã ghi trong transaction đó.
	const seen = new Set<string>();
	let acquiredInTx: string[] = [];
	const dataSource = {
		transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
			acquiredInTx = [];
			try {
				await cb(manager);
			} catch (err) {
				acquiredInTx.forEach((k) => seen.delete(k));
				throw err;
			}
		}),
	};
	const inbox = {
		tryAcquire: jest.fn(
			async (_m: unknown, consumer: string, eventId: string) => {
				const key = `${consumer}:${eventId}`;
				if (seen.has(key)) return false;
				seen.add(key);
				acquiredInTx.push(key);
				return true;
			},
		),
	};
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const config = {
		get: (key: string, def: unknown) =>
			key === 'KAFKA_CONSUMER_RETRY_BACKOFF_MS' ? 0 : def,
	};
	const runner = new KafkaConsumerRunner(
		dataSource as unknown as DataSource,
		inbox,
		producer as unknown as KafkaProducerService,
		config as unknown as ConfigService,
	);
	const emailProvider = {
		send: jest.fn().mockResolvedValue({ success: true }),
	};
	const userClient = options.userClient ?? {
		send: jest.fn(() => of({ email: 'user@example.com' })),
	};
	const controller = new OrderEventsController(
		runner,
		emailProvider,
		userClient as unknown as ClientProxy,
	);
	return { controller, manager, emailProvider, userClient, inbox, producer };
}

const created = (eventId?: string) =>
	createEnvelope({
		eventId,
		type: MESSAGE_TYPE.ORDER_CREATED,
		orderId: 'order-1',
		payload: { userId: 'user-1', totalAmount: 250 },
	});

describe('OrderEventsController', () => {
	it('lưu SentNotification bằng manager của transaction runner với sourceEvent=OrderCreated', async () => {
		const { controller, manager, emailProvider } = build();

		await controller.onOrderEvent(created());

		expect(emailProvider.send).toHaveBeenCalledTimes(1);
		expect(emailProvider.send.mock.calls[0][0]).toBe('user@example.com');
		expect(manager.create).toHaveBeenCalledWith(
			SentNotification,
			expect.objectContaining({
				channel: NotificationChannel.EMAIL,
				recipient: 'user@example.com',
				status: NotificationStatus.SENT,
				sourceEvent: 'OrderCreated',
			}),
		);
		expect(manager.save).toHaveBeenCalledTimes(1);
	});

	it('ghi nhận FAILED khi provider báo gửi thất bại', async () => {
		const { controller, manager, emailProvider } = build();
		emailProvider.send.mockResolvedValue({ success: false });

		await controller.onOrderEvent(created());

		expect(manager.create).toHaveBeenCalledWith(
			SentNotification,
			expect.objectContaining({ status: NotificationStatus.FAILED }),
		);
	});

	it('cùng eventId giao 2 lần chỉ gửi 1 email và lưu 1 dòng', async () => {
		const { controller, manager, emailProvider } = build();
		const message = created('11111111-1111-4111-8111-111111111111');

		await controller.onOrderEvent(message);
		await controller.onOrderEvent(message);

		expect(emailProvider.send).toHaveBeenCalledTimes(1);
		expect(manager.save).toHaveBeenCalledTimes(1);
	});

	it('OrderStatusChanged gửi email với nội dung chuyển trạng thái', async () => {
		const { controller, manager, emailProvider } = build();

		await controller.onOrderEvent(
			createEnvelope({
				type: MESSAGE_TYPE.ORDER_STATUS_CHANGED,
				orderId: 'order-1',
				payload: {
					userId: 'user-1',
					previousStatus: 'PAID',
					status: 'SHIPPED',
				},
			}),
		);

		expect(emailProvider.send).toHaveBeenCalledTimes(1);
		expect(emailProvider.send.mock.calls[0][2]).toContain('PAID');
		expect(emailProvider.send.mock.calls[0][2]).toContain('SHIPPED');
		expect(manager.create).toHaveBeenCalledWith(
			SentNotification,
			expect.objectContaining({ sourceEvent: 'OrderStatusChanged' }),
		);
	});

	it('OrderPaid không gửi email, không tra user nhưng inbox vẫn được đánh dấu', async () => {
		const { controller, manager, emailProvider, userClient, inbox } = build();

		await controller.onOrderEvent(
			createEnvelope({
				type: MESSAGE_TYPE.ORDER_PAID,
				orderId: 'order-1',
				payload: { userId: 'user-1' },
			}),
		);

		expect(emailProvider.send).not.toHaveBeenCalled();
		expect(manager.save).not.toHaveBeenCalled();
		expect((userClient as { send: jest.Mock }).send).not.toHaveBeenCalled();
		expect(inbox.tryAcquire).toHaveBeenCalledTimes(1);
	});

	it('tra User qua TCP lỗi thì recipient fallback về userId', async () => {
		const { controller, manager, emailProvider } = build({
			userClient: {
				send: jest.fn(() => throwError(() => new Error('user down'))),
			},
		});

		await controller.onOrderEvent(created());

		expect(emailProvider.send.mock.calls[0][0]).toBe('user-1');
		expect(manager.create).toHaveBeenCalledWith(
			SentNotification,
			expect.objectContaining({ recipient: 'user-1' }),
		);
	});

	it('envelope sai hình dạng đi vào DLQ, không gửi email', async () => {
		const { controller, emailProvider, producer } = build();

		await controller.onOrderEvent({ foo: 'bar' });

		expect(emailProvider.send).not.toHaveBeenCalled();
		expect(producer.send).toHaveBeenCalledWith(
			'order-events.dlq',
			null,
			{ foo: 'bar' },
			expect.any(Object),
		);
	});

	it('provider ném lỗi thì retry rồi DLQ, không lưu SentNotification', async () => {
		const { controller, manager, emailProvider, producer } = build();
		emailProvider.send.mockRejectedValue(new Error('smtp down'));

		await controller.onOrderEvent(created());

		expect(emailProvider.send).toHaveBeenCalledTimes(3);
		expect(manager.save).not.toHaveBeenCalled();
		expect(producer.send).toHaveBeenCalledWith(
			'order-events.dlq',
			'order-1',
			expect.anything(),
			expect.any(Object),
		);
	});
});

describe('buildOrderEventEmail', () => {
	it('OrderCreated: subject chứa orderId, body chứa tổng tiền', () => {
		const email = buildOrderEventEmail('OrderCreated', 'o-1', {
			totalAmount: 99,
		});
		expect(email?.subject).toContain('o-1');
		expect(email?.body).toContain('99');
	});

	it('OrderStatusChanged: body chứa trạng thái cũ và mới', () => {
		const email = buildOrderEventEmail('OrderStatusChanged', 'o-1', {
			previousStatus: 'A',
			status: 'B',
		});
		expect(email?.body).toContain('A');
		expect(email?.body).toContain('B');
	});

	it.each(['OrderPaid', 'OrderCancelled', 'Unknown'])(
		'%s: không có email',
		(type) => {
			expect(buildOrderEventEmail(type, 'o-1', {})).toBeNull();
		},
	);
});
