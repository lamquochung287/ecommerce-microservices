import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { CreateOrderHandler } from './create-order.handler';
import { CreateOrderCommand } from '../create-order.command';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { OutboxMessage, OutboxWriter } from '@lib/messaging';
import { Refund } from '../../entities/refund.entity';
import { CreateOrderDto } from '../../dto/order.dto';
import {
	InventoryReservationService,
	ReservationItem,
} from '../../saga/inventory-reservation.service';
import { PaymentProvider } from '../../saga/payment-provider.interface';

const dataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 5432,
	username: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'password',
	database: process.env.DB_NAME || 'ecommerce',
	entities: [Order, OrderItem, OutboxMessage, Refund],
	synchronize: false,
});

const baseDto: CreateOrderDto = {
	userId: '11111111-1111-1111-1111-111111111111',
	shippingAddress: {
		recipientName: 'Test User',
		recipientPhone: '0900000000',
		addressLine1: '123 Test St',
		city: 'HCMC',
		country: 'VN',
	},
	items: [
		{
			productId: '22222222-2222-2222-2222-222222222222',
			quantity: 2,
			unitPrice: 100,
		},
	],
};

function fakeConfigService(): ConfigService {
	return { get: () => undefined } as unknown as ConfigService;
}

describe('CreateOrderHandler (saga)', () => {
	beforeAll(async () => {
		await dataSource.initialize();
	});

	afterAll(async () => {
		await dataSource.destroy();
	});

	afterEach(async () => {
		await dataSource.getRepository(Order).delete({ userId: baseDto.userId });
	});

	it('Reserve Inventory fail (hết hàng) -> throw, Order không được tạo, không cần compensate', async () => {
		const reserveCalls: ReservationItem[][] = [];
		const releaseCalls: ReservationItem[][] = [];
		const inventory: Partial<InventoryReservationService> = {
			reserve: jest.fn(async (items) => {
				reserveCalls.push(items);
				throw new RpcException({
					statusCode: 409,
					message: 'Không đủ tồn kho',
				});
			}),
			release: jest.fn(async (items) => {
				releaseCalls.push(items);
			}),
		};
		const paymentProvider: PaymentProvider = { capture: jest.fn() };

		const handler = new CreateOrderHandler(
			dataSource,
			fakeConfigService(),
			new OutboxWriter({ source: 'orders' }),
			inventory as InventoryReservationService,
			paymentProvider,
		);

		await expect(
			handler.execute(new CreateOrderCommand(baseDto)),
		).rejects.toThrow();

		expect(reserveCalls.length).toBe(1);
		expect(releaseCalls.length).toBe(0); // chưa reserve được gì thì không cần compensate
		expect(paymentProvider.capture).not.toHaveBeenCalled();

		const orders = await dataSource
			.getRepository(Order)
			.find({ where: { userId: baseDto.userId } });
		expect(orders.length).toBe(0);
	});

	it('Reserve OK nhưng Capture Payment fail -> compensate release inventory, Order CANCELLED', async () => {
		const reserveCalls: ReservationItem[][] = [];
		const releaseCalls: ReservationItem[][] = [];
		const inventory: Partial<InventoryReservationService> = {
			reserve: jest.fn(async (items) => {
				reserveCalls.push(items);
			}),
			release: jest.fn(async (items) => {
				releaseCalls.push(items);
			}),
		};
		const paymentProvider: PaymentProvider = {
			capture: jest.fn(async () => ({
				success: false,
				failureReason: 'insufficient funds (test)',
			})),
		};

		const handler = new CreateOrderHandler(
			dataSource,
			fakeConfigService(),
			new OutboxWriter({ source: 'orders' }),
			inventory as InventoryReservationService,
			paymentProvider,
		);

		await expect(
			handler.execute(new CreateOrderCommand(baseDto)),
		).rejects.toThrow(RpcException);

		expect(reserveCalls.length).toBe(1);
		expect(releaseCalls.length).toBe(1); // compensation phải release đúng item đã reserve
		expect(releaseCalls[0]).toEqual([
			{
				productId: baseDto.items[0].productId,
				quantity: baseDto.items[0].quantity,
			},
		]);

		const orders = await dataSource
			.getRepository(Order)
			.find({ where: { userId: baseDto.userId } });
		expect(orders.length).toBe(1);
		expect(orders[0].status).toBe(OrderStatus.CANCELLED);
	});

	it('Reserve OK và Capture Payment OK -> Order PROCESSING + outbox event ghi cùng transaction', async () => {
		const inventory: Partial<InventoryReservationService> = {
			reserve: jest.fn(async () => {}),
			release: jest.fn(async () => {}),
		};
		const paymentProvider: PaymentProvider = {
			capture: jest.fn(async () => ({ success: true, transactionId: 'TXN-1' })),
		};

		const handler = new CreateOrderHandler(
			dataSource,
			fakeConfigService(),
			new OutboxWriter({ source: 'orders' }),
			inventory as InventoryReservationService,
			paymentProvider,
		);

		const result = await handler.execute(new CreateOrderCommand(baseDto));

		expect(result).not.toBeNull();
		expect(result!.status).toBe(OrderStatus.PROCESSING);
		expect(Number(result!.subtotal)).toBe(200);

		const matching = await dataSource
			.getRepository(OutboxMessage)
			.findOne({ where: { key: result!.id, eventType: 'OrderCreated' } });
		expect(matching).not.toBeNull();
		expect(matching!.topic).toBe('order-events');
		expect(matching!.source).toBe('orders');
		expect(matching!.eventId).toEqual(expect.any(String));
		expect(matching!.payload).toMatchObject({ userId: baseDto.userId });
	});
});
