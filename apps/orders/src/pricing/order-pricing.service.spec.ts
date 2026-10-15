import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { ProductClient } from '../clients/product.client';
import { PromotionClient } from '../clients/promotion.client';
import { refundAmountOf } from './money';
import { OrderPricingService } from './order-pricing.service';

function setup(
	products: Record<string, unknown>,
	env: Record<string, unknown> = {},
	validate: jest.Mock = jest.fn(),
) {
	const getProduct = jest.fn((id: string) => {
		const value = products[id];
		if (value instanceof Error) return Promise.reject(value);
		return Promise.resolve(value);
	});
	const config = { get: (key: string) => env[key] } as unknown as ConfigService;
	const service = new OrderPricingService(
		{ getProduct } as unknown as ProductClient,
		{ validate } as unknown as PromotionClient,
		config,
	);
	return { service, getProduct, validate };
}

describe('OrderPricingService', () => {
	it('decimal string -> number, tax làm tròn 2 số, ship lấy từ env', async () => {
		const { service } = setup(
			{
				a: { price: '19.99', isActive: true },
				b: { price: '5.55', isActive: true },
			},
			{ ORDER_TAX_RATE: '0.07', ORDER_SHIPPING_FEE_FLAT: '10' },
		);

		const priced = await service.priceItems([
			{ productId: 'a', quantity: 3 },
			{ productId: 'b', quantity: 1 },
		]);

		expect(priced.items).toEqual([
			{ productId: 'a', quantity: 3, unitPrice: 19.99 },
			{ productId: 'b', quantity: 1, unitPrice: 5.55 },
		]);
		expect(priced.subtotal).toBe(65.52); // 59.97 + 5.55
		expect(priced.taxAmount).toBe(4.59); // 65.52 * 0.07 = 4.5864
		expect(priced.shippingFee).toBe(10);
		expect(priced.discountAmount).toBe(0);
		expect(priced.totalAmount).toBe(80.11);
	});

	it('mặc định tax 0.1 và ship 30000', async () => {
		const { service } = setup({ a: { price: '100000', isActive: true } });
		const priced = await service.priceItems([{ productId: 'a', quantity: 2 }]);
		expect(priced.subtotal).toBe(200000);
		expect(priced.taxAmount).toBe(20000);
		expect(priced.shippingFee).toBe(30000);
		expect(priced.totalAmount).toBe(250000);
	});

	it('discount được trừ vào total', () => {
		const { service } = setup({});
		const totals = service.computeTotals(
			[{ productId: 'a', quantity: 1, unitPrice: 100000 }],
			10000,
		);
		expect(totals.discountAmount).toBe(10000);
		expect(totals.totalAmount).toBe(130000);
	});

	it('Product 404 -> 400', async () => {
		const { service } = setup({
			a: new RpcException({ statusCode: 404, message: 'Product not found' }),
		});
		await expect(
			service.priceItems([{ productId: 'a', quantity: 1 }]),
		).rejects.toMatchObject({
			error: { statusCode: 400 },
		});
	});

	it('Product inactive hoặc giá không hợp lệ -> 400', async () => {
		const inactive = setup({ a: { price: '10', isActive: false } });
		await expect(
			inactive.service.priceItems([{ productId: 'a', quantity: 1 }]),
		).rejects.toMatchObject({ error: { statusCode: 400 } });

		const badPrice = setup({ a: { price: 'abc', isActive: true } });
		await expect(
			badPrice.service.priceItems([{ productId: 'a', quantity: 1 }]),
		).rejects.toMatchObject({ error: { statusCode: 400 } });
	});

	describe('voucher', () => {
		const products = { a: { price: '100000', isActive: true } };

		it('validate theo subtotal; total = subtotal + tax + ship - discount; refundAmountOf = subtotal + tax - discount', async () => {
			const validate = jest
				.fn()
				.mockResolvedValue({ code: 'SALE10', discountAmount: 20000 });
			const { service } = setup(products, {}, validate);

			const priced = await service.priceItems(
				[{ productId: 'a', quantity: 2 }],
				'SALE10',
			);

			expect(validate).toHaveBeenCalledWith('SALE10', 200000);
			expect(priced.voucherCode).toBe('SALE10');
			expect(priced.discountAmount).toBe(20000);
			expect(priced.totalAmount).toBe(230000); // 200000 + 20000 + 30000 - 20000
			expect(refundAmountOf(priced)).toBe(200000); // subtotal + tax - discount
		});

		it('không voucherCode: không gọi Promotion, discount 0', async () => {
			const { service, validate } = setup(products);
			const priced = await service.priceItems([
				{ productId: 'a', quantity: 1 },
			]);
			expect(validate).not.toHaveBeenCalled();
			expect(priced.voucherCode).toBeNull();
			expect(priced.discountAmount).toBe(0);
		});

		it('Promotion 400/404 đi thẳng ra ngoài', async () => {
			const error = new RpcException({
				statusCode: 400,
				message: 'Voucher đã hết lượt',
			});
			const { service } = setup(
				products,
				{},
				jest.fn().mockRejectedValue(error),
			);
			await expect(
				service.priceItems([{ productId: 'a', quantity: 1 }], 'SALE10'),
			).rejects.toBe(error);
		});
	});

	it('lỗi khác (timeout) được giữ nguyên', async () => {
		const boom = new Error('timeout');
		const { service } = setup({ a: boom });
		await expect(
			service.priceItems([{ productId: 'a', quantity: 1 }]),
		).rejects.toBe(boom);
	});
});
