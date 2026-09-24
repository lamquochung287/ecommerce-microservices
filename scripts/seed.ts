import { Client } from 'pg';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const BATCH_SIZE = 1000;
const NUM_USERS = 10000;
const NUM_CATEGORIES = 50;
const NUM_PRODUCTS = 50000;
const NUM_ORDERS = 20000; // Số lượng đơn hàng cần seed

async function seed() {
	console.log('🌱 Bắt đầu quá trình Data Seeding...');
	const startTime = Date.now();

	const client = new Client({
		connectionString: 'postgres://root:password@localhost:5432/ecommerce',
	});

	await client.connect();
	console.log('✅ Đã kết nối tới PostgreSQL');

	try {
		// 1. Sinh UUIDs trước để liên kết (Foreign Keys)
		const userIds: string[] = Array.from({ length: NUM_USERS }, () => uuidv4());
		const categoryIds: string[] = Array.from({ length: NUM_CATEGORIES }, () => uuidv4());
		const productIds: string[] = Array.from({ length: NUM_PRODUCTS }, () => uuidv4());

		// 2. Hash password
		console.log('\n⏳ Đang mã hóa mật khẩu mặc định...');
		const defaultPassword = 'securePassword123';
		const hashedPassword = await bcrypt.hash(defaultPassword, 10);
		console.log('✅ Băm mật khẩu hoàn tất');

		// 3. Seed Users
		console.log(`\n⏳ Đang tiến hành tạo ${NUM_USERS} Users...`);
		for (let i = 0; i < NUM_USERS; i += BATCH_SIZE) {
			const batchSize = Math.min(BATCH_SIZE, NUM_USERS - i);
			const values: any[] = [];
			const placeholders: string[] = [];

			for (let j = 0; j < batchSize; j++) {
				const offset = j * 6;
				placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
				values.push(
					userIds[i + j], // userId
					faker.internet.email() + `-${Date.now()}-${i}-${j}`, // email (unique)
					hashedPassword, // password
					faker.person.fullName(), // fullName
					0, // permissions
					true, // isActive
				);
			}
			const query = `INSERT INTO users ("userId", email, password, "fullName", permissions, "isActive") VALUES ${placeholders.join(', ')}`;
			await client.query(query, values);
			console.log(`  -> Đã chèn ${i + batchSize} / ${NUM_USERS} users`);
		}

		// 4. Seed Categories
		console.log(`\n⏳ Đang tiến hành tạo ${NUM_CATEGORIES} Categories...`);
		const catValues: any[] = [];
		const catPlaceholders: string[] = [];
		for (let i = 0; i < NUM_CATEGORIES; i++) {
			const offset = i * 4;
			catPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
			catValues.push(
				categoryIds[i], // id
				faker.commerce.department() + ` ${i}`, // name
				faker.helpers.slugify(faker.commerce.department() + `-${i}-${Date.now()}`), // slug
				faker.lorem.sentence(), // description
			);
		}
		if (catPlaceholders.length > 0) {
			const query = `INSERT INTO categories (id, name, slug, description) VALUES ${catPlaceholders.join(', ')}`;
			await client.query(query, catValues);
			console.log(`  -> Đã chèn ${NUM_CATEGORIES} categories`);
		}

		// 5. Seed Products (Cần lưu mảng giá tiền để tạo Order hợp lý)
		console.log(`\n⏳ Đang tiến hành tạo ${NUM_PRODUCTS} Products...`);
		const productPrices = new Map<string, number>();

		for (let i = 0; i < NUM_PRODUCTS; i += BATCH_SIZE) {
			const batchSize = Math.min(BATCH_SIZE, NUM_PRODUCTS - i);
			const values: any[] = [];
			const placeholders: string[] = [];

			for (let j = 0; j < batchSize; j++) {
				const offset = j * 7;
				placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
				
				const productId = productIds[i + j];
				const randomCategoryId = categoryIds[Math.floor(Math.random() * categoryIds.length)];
				const price = parseFloat(faker.commerce.price({ min: 10, max: 1000 }));
				
				productPrices.set(productId, price);

				values.push(
					productId, // id
					faker.commerce.productName() + ` ${i}-${j}`, // name
					faker.helpers.slugify(faker.commerce.productName() + `-${i}-${j}-${Date.now()}`), // slug
					faker.lorem.paragraph(), // description
					price, // price
					faker.number.int({ min: 0, max: 1000 }), // stock
					randomCategoryId, // category_id
				);
			}
			const query = `INSERT INTO products (id, name, slug, description, price, stock, category_id) VALUES ${placeholders.join(', ')}`;
			await client.query(query, values);
			console.log(`  -> Đã chèn ${i + batchSize} / ${NUM_PRODUCTS} products`);
		}

		// 6. Seed Orders & Order Items
		console.log(`\n⏳ Đang tiến hành tạo ${NUM_ORDERS} Orders cùng OrderItems...`);
		const statuses = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
		
		for (let i = 0; i < NUM_ORDERS; i += BATCH_SIZE) {
			const batchSize = Math.min(BATCH_SIZE, NUM_ORDERS - i);
			
			const orderValues: any[] = [];
			const orderPlaceholders: string[] = [];
			
			const itemValues: any[] = [];
			const itemPlaceholders: string[] = [];
			let itemParamCount = 0;

			for (let j = 0; j < batchSize; j++) {
				const orderId = uuidv4();
				const randomUserId = userIds[Math.floor(Math.random() * userIds.length)];
				const numItems = faker.number.int({ min: 1, max: 5 }); // 1-5 products per order
				const status = statuses[Math.floor(Math.random() * statuses.length)];
				
				let totalAmount = 0;
				
				for (let k = 0; k < numItems; k++) {
					const randomProductId = productIds[Math.floor(Math.random() * productIds.length)];
					const unitPrice = productPrices.get(randomProductId) || 10;
					const quantity = faker.number.int({ min: 1, max: 3 });
					totalAmount += (unitPrice * quantity);

					itemPlaceholders.push(`($${itemParamCount + 1}, $${itemParamCount + 2}, $${itemParamCount + 3}, $${itemParamCount + 4}, $${itemParamCount + 5})`);
					itemValues.push(
						uuidv4(), // id
						orderId, // order_id
						randomProductId, // productId
						quantity, // quantity
						unitPrice // unitPrice
					);
					itemParamCount += 5;
				}

				const offset = j * 5;
				orderPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
				orderValues.push(
					orderId, // id
					randomUserId, // userId
					totalAmount, // totalAmount
					status, // status
					faker.location.streetAddress() + ', ' + faker.location.city() // shippingAddress
				);
			}

			// Insert Orders
			const orderQuery = `INSERT INTO orders (id, "userId", "totalAmount", status, "shippingAddress") VALUES ${orderPlaceholders.join(', ')}`;
			await client.query(orderQuery, orderValues);
			
			// Insert Order Items
			const itemQuery = `INSERT INTO order_items (id, order_id, "productId", quantity, "unitPrice") VALUES ${itemPlaceholders.join(', ')}`;
			await client.query(itemQuery, itemValues);

			console.log(`  -> Đã chèn ${i + batchSize} / ${NUM_ORDERS} orders`);
		}


		const endTime = Date.now();
		console.log(`\n🎉 SEED THÀNH CÔNG TẤT CẢ DATA! Hoàn thành trong ${(endTime - startTime) / 1000} giây.`);
	} catch (error) {
		console.error('❌ Lỗi trong quá trình Seed:', error);
	} finally {
		await client.end();
	}
}

seed();
