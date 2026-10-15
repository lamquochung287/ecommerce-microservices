// Mock jest.fn() và raw params có kiểu any/unknown theo thiết kế.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	KafkaConsumerRunner,
	KafkaProducerService,
	OutboxWriter,
	createEnvelope,
} from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import {
	SQL,
	createMockDataSource,
	createMockManager,
} from '../../../test/mock-manager';
import { ReservationService } from '../../domain/reservation.service';
import { ReservationStatus } from '../../entities/reservation.entity';
import { HandleInventoryCommandMessage } from '../handle-inventory-command-message.command';
import { HandleInventoryCommandMessageHandler } from './handle-inventory-command-message.handler';

const ORDER = '11111111-1111-4111-8111-111111111111';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface World {
	status: ReservationStatus | null;
	onHand: number;
	reserved: number;
}

/** Kho giả có trạng thái: UPDATE của service thật được áp vào `world` để kiểm tra kết quả cuối. */
function setup(initial: World, opts: { backoffMs?: number } = {}) {
	const world = { ...initial };
	const quantity = 2;
	const mock = createMockManager([
		[
			SQL.findReservation,
			() =>
				world.status
					? [
							{
								id: 'r1',
								orderId: ORDER,
								items: [{ productId: P1, variantId: null, quantity }],
								status: world.status,
								expiresAt: new Date(Date.now() - 5000),
							},
						]
					: [],
		],
		[
			SQL.lockStock,
			() => [
				{
					id: 's1',
					productId: P1,
					variantId: null,
					onHand: world.onHand,
					reserved: world.reserved,
				},
			],
		],
		[
			/UPDATE "stock_items" SET "onHand" = "onHand" \+ \$1, "reserved" = "reserved" \+ \$2/,
			(p) => {
				world.onHand += p[0] as number;
				world.reserved += p[1] as number;
				return [];
			},
		],
		[
			SQL.updateStock,
			(p) => {
				world.reserved += p[0] as number;
				return [];
			},
		],
		[
			SQL.updateReservationStatus,
			(p) => {
				world.status = p[0] as ReservationStatus;
				return [];
			},
		],
	]);
	const dataSource = createMockDataSource(mock.manager);
	const inbox = { tryAcquire: jest.fn().mockResolvedValue(true) };
	const producer = { send: jest.fn().mockResolvedValue(undefined) };
	const config = {
		get: (key: string, fallback: number) =>
			key === 'KAFKA_CONSUMER_RETRY_BACKOFF_MS'
				? (opts.backoffMs ?? 0)
				: fallback,
	} as unknown as ConfigService;
	const runner = new KafkaConsumerRunner(
		dataSource as never,
		inbox,
		producer as unknown as KafkaProducerService,
		config,
	);
	const outbox = { append: jest.fn().mockResolvedValue('evt') };
	const handler = new HandleInventoryCommandMessageHandler(
		runner,
		new ReservationService(),
		outbox as unknown as OutboxWriter,
	);
	const send = (type: string, eventId?: string) =>
		handler.execute(
			new HandleInventoryCommandMessage(
				createEnvelope({ type, orderId: ORDER, payload: {}, eventId }),
				KAFKA_TOPIC.INVENTORY_COMMANDS,
			),
		);
	return { world, send, outbox, inbox, producer, ...mock };
}

const appended = (outbox: { append: jest.Mock }): unknown[] =>
	(outbox.append.mock.calls as [unknown, unknown][]).map(([, input]) => input);

describe('HandleInventoryCommandMessageHandler', () => {
	beforeAll(() => {
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterAll(() => jest.restoreAllMocks());

	describe('CommitInventory', () => {
		it('RESERVED: trừ onHand/reserved, COMMITTED, outbox InventoryCommitted cùng manager', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});

			await t.send(MESSAGE_TYPE.COMMIT_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.COMMITTED,
				onHand: 8,
				reserved: 0,
			});
			expect(t.outbox.append).toHaveBeenCalledTimes(1);
			const [usedManager, input] = t.outbox.append.mock.calls[0];
			expect(usedManager).toBe(t.manager);
			expect(input).toEqual({
				topic: KAFKA_TOPIC.INVENTORY_EVENTS,
				type: MESSAGE_TYPE.INVENTORY_COMMITTED,
				orderId: ORDER,
				payload: {},
			});
		});

		it('COMMITTED: không đổi kho, vẫn phát lại InventoryCommitted', async () => {
			const t = setup({
				status: ReservationStatus.COMMITTED,
				onHand: 8,
				reserved: 0,
			});

			await t.send(MESSAGE_TYPE.COMMIT_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.COMMITTED,
				onHand: 8,
				reserved: 0,
			});
			expect(appended(t.outbox)).toEqual([
				expect.objectContaining({ type: MESSAGE_TYPE.INVENTORY_COMMITTED }),
			]);
		});

		it.each([
			[ReservationStatus.EXPIRED, 'RESERVATION_EXPIRED'],
			[ReservationStatus.RELEASED, 'RESERVATION_RELEASED'],
			[null, 'RESERVATION_NOT_FOUND'],
		])(
			'%s: InventoryCommitFailed(%s) và kho không đổi',
			async (status, reason) => {
				const t = setup({ status, onHand: 10, reserved: 0 });

				await t.send(MESSAGE_TYPE.COMMIT_INVENTORY);

				expect(t.world.onHand).toBe(10);
				expect(t.world.reserved).toBe(0);
				expect(appended(t.outbox)).toEqual([
					expect.objectContaining({
						topic: KAFKA_TOPIC.INVENTORY_EVENTS,
						type: MESSAGE_TYPE.INVENTORY_COMMIT_FAILED,
						orderId: ORDER,
						payload: { reason },
					}),
				]);
			},
		);
	});

	describe('ReleaseInventory', () => {
		it('RESERVED: trả reserved, RELEASED, không phát event', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});

			await t.send(MESSAGE_TYPE.RELEASE_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.RELEASED,
				onHand: 10,
				reserved: 0,
			});
			expect(t.outbox.append).not.toHaveBeenCalled();
		});

		it('COMMITTED: no-op', async () => {
			const t = setup({
				status: ReservationStatus.COMMITTED,
				onHand: 8,
				reserved: 0,
			});

			await t.send(MESSAGE_TYPE.RELEASE_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.COMMITTED,
				onHand: 8,
				reserved: 0,
			});
		});

		it('lặp lại sau RELEASED: no-op', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});

			await t.send(MESSAGE_TYPE.RELEASE_INVENTORY);
			await t.send(MESSAGE_TYPE.RELEASE_INVENTORY);

			expect(t.world.reserved).toBe(0);
		});
	});

	describe('RestockInventory', () => {
		it('COMMITTED: onHand tăng, RESTOCKED; lần 2 no-op', async () => {
			const t = setup({
				status: ReservationStatus.COMMITTED,
				onHand: 8,
				reserved: 0,
			});

			await t.send(MESSAGE_TYPE.RESTOCK_INVENTORY);
			await t.send(MESSAGE_TYPE.RESTOCK_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.RESTOCKED,
				onHand: 10,
				reserved: 0,
			});
			expect(t.outbox.append).not.toHaveBeenCalled();
		});

		it('Commit rồi Restock: kho về như ban đầu', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});

			await t.send(MESSAGE_TYPE.COMMIT_INVENTORY);
			await t.send(MESSAGE_TYPE.RESTOCK_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.RESTOCKED,
				onHand: 10,
				reserved: 0,
			});
		});

		it('Restock tới khi còn RESERVED, Commit tới sau: RELEASED rồi InventoryCommitFailed, kho đúng', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});

			await t.send(MESSAGE_TYPE.RESTOCK_INVENTORY);
			expect(t.world.status).toBe(ReservationStatus.RELEASED);
			await t.send(MESSAGE_TYPE.COMMIT_INVENTORY);

			expect(t.world).toEqual({
				status: ReservationStatus.RELEASED,
				onHand: 10,
				reserved: 0,
			});
			expect(appended(t.outbox)).toEqual([
				expect.objectContaining({
					type: MESSAGE_TYPE.INVENTORY_COMMIT_FAILED,
					payload: { reason: 'RESERVATION_RELEASED' },
				}),
			]);
		});
	});

	describe('độ tin cậy', () => {
		it('eventId trùng (inbox từ chối): handler không chạy lần 2', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});
			t.inbox.tryAcquire
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(false);
			const eventId = '99999999-9999-4999-8999-999999999999';

			await t.send(MESSAGE_TYPE.COMMIT_INVENTORY, eventId);
			await t.send(MESSAGE_TYPE.COMMIT_INVENTORY, eventId);

			expect(t.inbox.tryAcquire).toHaveBeenCalledTimes(2);
			expect(t.inbox.tryAcquire).toHaveBeenLastCalledWith(
				t.manager,
				'inventory-service',
				eventId,
			);
			expect(t.outbox.append).toHaveBeenCalledTimes(1);
		});

		it('type lạ: không throw, inbox vẫn ghi, không đụng kho/outbox/DLQ', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});

			await expect(t.send('SomethingNew')).resolves.toBeUndefined();

			expect(t.inbox.tryAcquire).toHaveBeenCalledTimes(1);
			expect(t.outbox.append).not.toHaveBeenCalled();
			expect(t.producer.send).not.toHaveBeenCalled();
			expect(t.world.reserved).toBe(2);
		});

		it('envelope không hợp lệ: vào DLQ, không throw', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});
			const handler = new HandleInventoryCommandMessageHandler(
				new KafkaConsumerRunner(
					createMockDataSource(t.manager) as never,
					t.inbox,
					t.producer as unknown as KafkaProducerService,
					{ get: (_k: string, d: number) => d } as unknown as ConfigService,
				),
				new ReservationService(),
				t.outbox as unknown as OutboxWriter,
			);

			await handler.execute(
				new HandleInventoryCommandMessage(
					{ nonsense: true },
					KAFKA_TOPIC.INVENTORY_COMMANDS,
				),
			);

			expect(t.producer.send).toHaveBeenCalledWith(
				'inventory-commands.dlq',
				null,
				{ nonsense: true },
				expect.any(Object),
			);
		});

		it('lỗi kỹ thuật (thiếu dòng kho): retry 3 lần rồi DLQ, không phát event bù, không throw', async () => {
			const t = setup({
				status: ReservationStatus.RESERVED,
				onHand: 10,
				reserved: 2,
			});
			// dòng kho biến mất: lockStock trả rỗng
			const original = t.query.getMockImplementation()!;
			t.query.mockImplementation((sql: string, params?: unknown[]) =>
				SQL.lockStock.test(sql)
					? Promise.resolve([])
					: original(sql, params ?? []),
			);

			await expect(
				t.send(MESSAGE_TYPE.COMMIT_INVENTORY),
			).resolves.toBeUndefined();

			expect(t.inbox.tryAcquire).toHaveBeenCalledTimes(3);
			expect(t.producer.send).toHaveBeenCalledTimes(1);
			expect(t.producer.send.mock.calls[0][0]).toBe('inventory-commands.dlq');
			expect(t.outbox.append).not.toHaveBeenCalled();
		});
	});
});
