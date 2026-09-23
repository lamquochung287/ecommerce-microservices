import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

describe('OrdersController', () => {
	let ordersController: OrdersController;
	let queryBus: QueryBus;

	beforeEach(async () => {
		const app: TestingModule = await Test.createTestingModule({
			controllers: [OrdersController],
			providers: [
				{
					provide: CommandBus,
					useValue: {
						execute: jest.fn(),
					},
				},
				{
					provide: QueryBus,
					useValue: {
						execute: jest.fn().mockResolvedValue([{ id: 1, userId: 1, productId: 1, quantity: 2 }]),
					},
				},
			],
		}).compile();

		ordersController = app.get<OrdersController>(OrdersController);
		queryBus = app.get<QueryBus>(QueryBus);
	});

	describe('getOrders', () => {
		it('should return an array of orders', async () => {
			const result = await ordersController.getOrders();
			expect(result).toEqual([{ id: 1, userId: 1, productId: 1, quantity: 2 }]);
			expect(queryBus.execute).toHaveBeenCalled();
		});
	});
});
