import 'dotenv/config';
import { DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { AdjustStockHandler } from './adjust-stock.handler';
import { AdjustStockCommand } from '../adjust-stock.command';
import { Product } from '../../entities/product.entity';
import { Category } from '../../entities/category.entity';
import { Brand } from '../../entities/brand.entity';
import { ProductVariant } from '../../entities/product-variant.entity';
import { AttributeValue } from '../../entities/attribute-value.entity';
import { Attribute } from '../../entities/attribute.entity';

const dataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 5432,
	username: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'password',
	database: process.env.DB_NAME || 'ecommerce',
	entities: [
		Product,
		Category,
		Brand,
		ProductVariant,
		AttributeValue,
		Attribute,
	],
	synchronize: false,
});

describe('AdjustStockHandler (concurrency)', () => {
	let handler: AdjustStockHandler;
	let productId: string;

	beforeAll(async () => {
		await dataSource.initialize();
		handler = new AdjustStockHandler(dataSource);

		const category = await dataSource.getRepository(Category).save({
			name: 'Concurrency Test Category',
			slug: `concurrency-test-category-${Date.now()}`,
		});
		const product = await dataSource.getRepository(Product).save({
			name: 'Concurrency Test Product',
			slug: `concurrency-test-product-${Date.now()}`,
			description: 'test',
			price: 10,
			stock: 10,
			category,
		});
		productId = product.id;
	});

	afterAll(async () => {
		await dataSource.getRepository(Product).delete({ id: productId });
		await dataSource.destroy();
	});

	it('không bán vượt tồn kho khi 2 request trừ kho đồng thời vượt quá số lượng còn lại', async () => {
		// stock = 10, 2 request cùng trừ 8 -> tổng 16 > 10, phải có ít nhất 1 request fail
		const results = await Promise.allSettled([
			handler.execute(new AdjustStockCommand({ productId, delta: -8 })),
			handler.execute(new AdjustStockCommand({ productId, delta: -8 })),
		]);

		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');

		expect(fulfilled.length).toBe(1);
		expect(rejected.length).toBe(1);
		expect(rejected[0].reason).toBeInstanceOf(RpcException);

		const finalProduct = await dataSource
			.getRepository(Product)
			.findOne({ where: { id: productId } });
		expect(finalProduct?.stock).toBe(2); // 10 - 8 = 2, không thể xuống âm
	});
});
