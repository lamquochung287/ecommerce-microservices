import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus } from '@nestjs/cqrs';
import { DataSource, EntityManager } from 'typeorm';
import {
	KafkaConsumerRunner,
	KafkaProducerService,
	createEnvelope,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import {
	VoucherRedemption,
	VoucherRedemptionStatus,
} from '../../entities/voucher-redemption.entity';
import { Voucher } from '../../entities/voucher.entity';
import { ConfirmVoucherCommand } from '../confirm-voucher.command';
import { HandleOrderEventMessage } from '../handle-order-event-message.command';
import { ReleaseVoucherCommand } from '../release-voucher.command';
import { ConfirmVoucherHandler } from './confirm-voucher.handler';
import { HandleOrderEventMessageHandler } from './handle-order-event-message.handler';
import { ReleaseVoucherHandler } from './release-voucher.handler';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Ghép runner thật (inbox + retry + DLQ) với handler confirm/release thật; chỉ mock DB/Kafka.
 * Inbox mô phỏng bằng Set eventId để kiểm tra khử trùng.
 */
function setup(initial: VoucherRedemptionStatus | null, usageCount = 1) {
	const voucher = { id: 'v1', usageCount } as Voucher;
	const redemption = (
		initial ? { orderId: ORDER_ID, voucherId: 'v1', status: initial } : null
	) as VoucherRedemption | null;
	const manager = {
		findOne: jest.fn((entity: unknown) =>
			Promise.resolve(entity === Voucher ? voucher : redemption),
		),
		save: jest.fn().mockResolvedValue(undefined),
		update: jest.fn(
			(
				_e: unknown,
				where: { status: VoucherRedemptionStatus },
				set: { status: VoucherRedemptionStatus },
			) => {
				if (redemption && redemption.status === where.status) {
					redemption.status = set.status;
					return Promise.resolve({ affected: 1 });
				}
				return Promise.resolve({ affected: 0 });
			},
		),
	};
	const dataSource = {
		transaction: jest.fn((cb: (m: EntityManager) => unknown) =>
			cb(manager as unknown as EntityManager),
		),
	};
	const seen = new Set<string>();
	const inbox = {
		tryAcquire: jest.fn((_m: unknown, _c: string, eventId: string) => {
			if (seen.has(eventId)) return Promise.resolve(false);
			seen.add(eventId);
			return Promise.resolve(true);
		}),
	};
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const config = {
		get: (key: string, fallback: unknown) =>
			key === 'KAFKA_CONSUMER_RETRY_BACKOFF_MS' ? 0 : fallback,
	} as unknown as ConfigService;
	const runner = new KafkaConsumerRunner(
		dataSource as unknown as DataSource,
		inbox,
		producer as unknown as KafkaProducerService,
		config,
	);

	const confirm = new ConfirmVoucherHandler();
	const release = new ReleaseVoucherHandler(
		dataSource as unknown as DataSource,
	);
	const commandBus = {
		execute: jest.fn((cmd: unknown) =>
			cmd instanceof ConfirmVoucherCommand
				? confirm.execute(cmd)
				: cmd instanceof ReleaseVoucherCommand
					? release.execute(cmd)
					: Promise.reject(new Error('unexpected command')),
		),
	};
	const handler = new HandleOrderEventMessageHandler(
		runner,
		commandBus as unknown as CommandBus,
	);
	const send = (type: string, payload: unknown, eventId?: string) =>
		handler.execute(
			new HandleOrderEventMessage(
				createEnvelope({ type, orderId: ORDER_ID, payload, eventId }),
				KAFKA_TOPIC.ORDER_EVENTS,
			),
		);
	return { voucher, redemption, inbox, producer, commandBus, send };
}

const CANCELLED = (paid: boolean) => ({
	userId: 'u1',
	paid,
	cancelReason: 'X',
	voucherCode: 'SALE',
});

describe('HandleOrderEventMessageHandler', () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it('OrderPaid: RESERVED -> CONFIRMED, usageCount giữ nguyên; inbox khoá theo promotion-service', async () => {
		const { voucher, redemption, inbox, send } = setup(
			VoucherRedemptionStatus.RESERVED,
		);

		await send(MESSAGE_TYPE.ORDER_PAID, { userId: 'u1', voucherCode: 'SALE' });

		expect(redemption?.status).toBe(VoucherRedemptionStatus.CONFIRMED);
		expect(voucher.usageCount).toBe(1);
		expect(inbox.tryAcquire.mock.calls[0][1]).toBe(CONSUMER_GROUP.PROMOTION);
	});

	it('OrderPaid của đơn không có voucher: no-op, không lỗi, không DLQ', async () => {
		const { producer, send } = setup(null);

		await send(MESSAGE_TYPE.ORDER_PAID, { userId: 'u1' });

		expect(producer.send).not.toHaveBeenCalled();
	});

	it('OrderCancelled{paid:false}: RELEASED, usageCount - 1', async () => {
		const { voucher, redemption, send } = setup(
			VoucherRedemptionStatus.RESERVED,
			2,
		);

		await send(MESSAGE_TYPE.ORDER_CANCELLED, CANCELLED(false));

		expect(redemption?.status).toBe(VoucherRedemptionStatus.RELEASED);
		expect(voucher.usageCount).toBe(1);
	});

	it('OrderCancelled{paid:true}: giữ nguyên redemption và usageCount', async () => {
		const { voucher, redemption, commandBus, send } = setup(
			VoucherRedemptionStatus.CONFIRMED,
			2,
		);

		await send(MESSAGE_TYPE.ORDER_CANCELLED, CANCELLED(true));

		expect(redemption?.status).toBe(VoucherRedemptionStatus.CONFIRMED);
		expect(voucher.usageCount).toBe(2);
		expect(commandBus.execute).not.toHaveBeenCalled();
	});

	it('OrderCancelled thiếu cờ paid: không trả lượt (an toàn)', async () => {
		const { voucher, commandBus, send } = setup(
			VoucherRedemptionStatus.RESERVED,
			2,
		);

		await send(MESSAGE_TYPE.ORDER_CANCELLED, { userId: 'u1' });

		expect(commandBus.execute).not.toHaveBeenCalled();
		expect(voucher.usageCount).toBe(2);
	});

	it('OrderCancelled{paid:false} sau khi đã CONFIRMED: no-op (không trả lượt đã dùng)', async () => {
		const { voucher, redemption, send } = setup(
			VoucherRedemptionStatus.CONFIRMED,
			2,
		);

		await send(MESSAGE_TYPE.ORDER_CANCELLED, CANCELLED(false));

		expect(redemption?.status).toBe(VoucherRedemptionStatus.CONFIRMED);
		expect(voucher.usageCount).toBe(2);
	});

	it('eventId trùng: lần hai là no-op (usageCount chỉ giảm một lần)', async () => {
		const { voucher, commandBus, send } = setup(
			VoucherRedemptionStatus.RESERVED,
			3,
		);

		await send(MESSAGE_TYPE.ORDER_CANCELLED, CANCELLED(false), 'evt-1');
		await send(MESSAGE_TYPE.ORDER_CANCELLED, CANCELLED(false), 'evt-1');

		expect(voucher.usageCount).toBe(2);
		expect(commandBus.execute).toHaveBeenCalledTimes(1);
	});

	it('type khác (OrderCreated): bỏ qua, không DLQ', async () => {
		const { producer, commandBus, send } = setup(
			VoucherRedemptionStatus.RESERVED,
		);

		await send(MESSAGE_TYPE.ORDER_CREATED, {});

		expect(commandBus.execute).not.toHaveBeenCalled();
		expect(producer.send).not.toHaveBeenCalled();
	});

	it('envelope không hợp lệ: vào DLQ, không xử lý', async () => {
		const { producer, commandBus } = setup(null);
		const runner = new KafkaConsumerRunner(
			{ transaction: jest.fn() } as unknown as DataSource,
			{ tryAcquire: jest.fn() },
			producer as unknown as KafkaProducerService,
			{ get: (_k: string, f: unknown) => f } as unknown as ConfigService,
		);
		const handler = new HandleOrderEventMessageHandler(
			runner,
			commandBus as unknown as CommandBus,
		);

		await handler.execute(
			new HandleOrderEventMessage({ nonsense: true }, KAFKA_TOPIC.ORDER_EVENTS),
		);

		expect(producer.send).toHaveBeenCalledTimes(1);
		expect(commandBus.execute).not.toHaveBeenCalled();
	});
});
