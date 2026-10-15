// Mock runner/bus trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { CommandBus } from '@nestjs/cqrs';
import { DataSource, EntityManager } from 'typeorm';
import {
	KafkaConsumerRunner,
	MessageEnvelope,
	OutboxWriter,
} from '@lib/messaging';
import {
	CONSUMER_GROUP,
	KAFKA_TOPIC,
	MESSAGE_TYPE,
} from 'libs/constant/kafka.constant';
import { PaymentCommandsConsumer } from './payment-commands.consumer';
import { HandlePaymentCommandMessageCommand } from '../commands/handle-payment-command-message.command';
import { HandlePaymentCommandMessageHandler } from '../commands/handlers/handle-payment-command-message.handler';
import { CancelPaymentIntentCommand } from '../commands/cancel-payment-intent.command';
import { RefundPaymentCommand } from '../commands/refund-payment.command';

const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const envelope = (type: string, payload: unknown): MessageEnvelope => ({
	eventId: 'e-1',
	type,
	orderId: ORDER_ID,
	occurredAt: new Date().toISOString(),
	version: 1,
	payload,
});

describe('PaymentCommandsConsumer', () => {
	function setup() {
		const run = jest.fn().mockResolvedValue(undefined);
		const execute = jest.fn().mockResolvedValue(undefined);
		const append = jest.fn().mockResolvedValue('evt');
		const manager = {} as EntityManager;
		const dataSource = {
			transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
				cb(manager),
			),
		} as unknown as DataSource;
		const consumer = new PaymentCommandsConsumer(
			{ run } as unknown as KafkaConsumerRunner,
			{ execute } as unknown as CommandBus,
			{ append } as unknown as OutboxWriter,
			dataSource,
		);
		return { consumer, run, execute, append, manager };
	}

	it('chạy qua runner với group payment-service và chuyển message thành command cùng manager', async () => {
		const { consumer, run, execute, manager } = setup();
		const message = envelope(MESSAGE_TYPE.CANCEL_PAYMENT_INTENT, {});

		await consumer.onPaymentCommand(message);

		const input = run.mock.calls[0][0];
		expect(input.consumer).toBe(CONSUMER_GROUP.PAYMENT);
		expect(input.topic).toBe(KAFKA_TOPIC.PAYMENT_COMMANDS);
		expect(input.message).toBe(message);
		await input.handle(manager, message);
		const cmd = execute.mock.calls[0][0] as HandlePaymentCommandMessageCommand;
		expect(cmd.manager).toBe(manager);
		expect(cmd.envelope).toBe(message);
	});

	it('RefundPayment hết lượt retry: phát PaymentRefundFailed để Orders không kẹt PENDING', async () => {
		const { consumer, run, append, manager } = setup();
		await consumer.onPaymentCommand({});
		const { onExhausted } = run.mock.calls[0][0];

		await onExhausted(
			envelope(MESSAGE_TYPE.REFUND_PAYMENT, { amount: 1, reason: 'x' }),
			new Error('boom'),
		);

		expect(append).toHaveBeenCalledWith(manager, {
			topic: KAFKA_TOPIC.PAYMENT_EVENTS,
			type: MESSAGE_TYPE.PAYMENT_REFUND_FAILED,
			orderId: ORDER_ID,
			payload: { reason: 'Refund processing failed: boom' },
		});
	});

	it('CancelPaymentIntent hết lượt retry: không phát gì', async () => {
		const { consumer, run, append } = setup();
		await consumer.onPaymentCommand({});
		await run.mock.calls[0][0].onExhausted(
			envelope(MESSAGE_TYPE.CANCEL_PAYMENT_INTENT, {}),
			new Error('boom'),
		);
		expect(append).not.toHaveBeenCalled();
	});
});

describe('HandlePaymentCommandMessageHandler', () => {
	const manager = {} as EntityManager;
	const setup = () => {
		const execute = jest.fn().mockResolvedValue(undefined);
		return {
			execute,
			handler: new HandlePaymentCommandMessageHandler({
				execute,
			} as unknown as CommandBus),
		};
	};

	it('CancelPaymentIntent: dispatch với orderId của envelope', async () => {
		const { handler, execute } = setup();
		await handler.execute(
			new HandlePaymentCommandMessageCommand(
				manager,
				envelope(MESSAGE_TYPE.CANCEL_PAYMENT_INTENT, {}),
			),
		);
		const cmd = execute.mock.calls[0][0] as CancelPaymentIntentCommand;
		expect(cmd).toBeInstanceOf(CancelPaymentIntentCommand);
		expect(cmd.orderId).toBe(ORDER_ID);
		expect(cmd.manager).toBe(manager);
	});

	it('RefundPayment: dispatch amount và reason từ payload', async () => {
		const { handler, execute } = setup();
		await handler.execute(
			new HandlePaymentCommandMessageCommand(
				manager,
				envelope(MESSAGE_TYPE.REFUND_PAYMENT, {
					amount: 200000,
					reason: 'USER',
				}),
			),
		);
		const cmd = execute.mock.calls[0][0] as RefundPaymentCommand;
		expect(cmd).toBeInstanceOf(RefundPaymentCommand);
		expect(cmd).toMatchObject({
			orderId: ORDER_ID,
			amount: 200000,
			reason: 'USER',
		});
	});

	it('type lạ: bỏ qua, không dispatch', async () => {
		const { handler, execute } = setup();
		await handler.execute(
			new HandlePaymentCommandMessageCommand(
				manager,
				envelope('SomethingElse', {}),
			),
		);
		expect(execute).not.toHaveBeenCalled();
	});
});
