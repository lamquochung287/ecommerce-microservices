// Mock bus trả any theo thiết kế của jest.fn.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CheckoutCommand } from './commands/checkout.command';
import { PreparePaymentCommand } from './commands/prepare-payment.command';
import { CheckoutDto } from './dto/checkout.dto';

describe('OrdersController', () => {
	let ordersController: OrdersController;
	let queryBus: QueryBus;
	let commandBus: CommandBus;

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
						execute: jest
							.fn()
							.mockResolvedValue([
								{ id: 1, userId: 1, productId: 1, quantity: 2 },
							]),
					},
				},
			],
		}).compile();

		ordersController = app.get<OrdersController>(OrdersController);
		queryBus = app.get<QueryBus>(QueryBus);
		commandBus = app.get<CommandBus>(CommandBus);
	});

	describe('getOrders', () => {
		it('should return an array of orders', async () => {
			const result = await ordersController.getOrders();
			expect(result).toEqual([{ id: 1, userId: 1, productId: 1, quantity: 2 }]);
			expect(queryBus.execute).toHaveBeenCalled();
		});
	});

	describe('checkout', () => {
		it('chuyển userId và dto vào CheckoutCommand', async () => {
			const dto = { items: [] } as unknown as CheckoutDto;
			await ordersController.checkout({ userId: 'u-1', dto });

			const command = (commandBus.execute as jest.Mock).mock
				.calls[0][0] as CheckoutCommand;
			expect(command).toBeInstanceOf(CheckoutCommand);
			expect(command.userId).toBe('u-1');
			expect(command.dto).toBe(dto);
		});
	});

	describe('getPaymentLink', () => {
		it('chuyển orderId và userId vào PreparePaymentCommand', async () => {
			await ordersController.getPaymentLink({ orderId: 'o-1', userId: 'u-1' });

			const command = (commandBus.execute as jest.Mock).mock
				.calls[0][0] as PreparePaymentCommand;
			expect(command).toBeInstanceOf(PreparePaymentCommand);
			expect(command.orderId).toBe('o-1');
			expect(command.userId).toBe('u-1');
		});
	});
});
