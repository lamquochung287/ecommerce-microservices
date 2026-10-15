import { Test, TestingModule } from '@nestjs/testing';
import { ProductController } from './product.controller';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';

describe('ProductController', () => {
	let productController: ProductController;
	let queryBus: QueryBus;

	beforeEach(async () => {
		const app: TestingModule = await Test.createTestingModule({
			controllers: [ProductController],
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
							.mockResolvedValue([{ id: 1, name: 'Product 1', price: 100 }]),
					},
				},
			],
		}).compile();

		productController = app.get<ProductController>(ProductController);
		queryBus = app.get<QueryBus>(QueryBus);
	});

	describe('getProducts', () => {
		it('should return an array of products', async () => {
			const result = await productController.getProducts({});
			expect(result).toEqual([{ id: 1, name: 'Product 1', price: 100 }]);
			expect(queryBus.execute).toHaveBeenCalled();
		});
	});

	describe('catalog only', () => {
		it('không còn xử lý tồn kho (thuộc Inventory)', () => {
			expect(Object.keys(PRODUCT_MESSAGE_PATTERN)).not.toContain(
				'ADJUST_STOCK',
			);
			expect('adjustStock' in productController).toBe(false);
		});
	});
});
