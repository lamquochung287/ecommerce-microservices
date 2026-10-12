import { Client } from 'pg';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { Action, ModuleName } from '../libs/constant/permission.constant';

const BATCH_SIZE = 1000;
const NUM_USERS = 2000; // User mới, được xuất ra CSV để đăng nhập
const NUM_BRANDS = 30;
const NUM_CATEGORIES = 50;
const NUM_PRODUCTS = 50000;
const NUM_PRODUCTS_WITH_VARIANTS = 10000;
const VARIANTS_PER_PRODUCT = 2;
const NUM_VOUCHERS = 100;
const NUM_ORDERS = 20000;

const DEFAULT_PASSWORD = 'Password123';
const CSV_PATH = path.join(__dirname, 'seeded-users.csv');

// Role "Customer": đủ quyền gọi các API phía khách hàng
const CUSTOMER_PERMISSIONS =
	(ModuleName.PRODUCT | Action.READ) |
	(ModuleName.ORDER | Action.CREATE | Action.READ) |
	(ModuleName.PAYMENT | Action.READ) |
	(ModuleName.REVIEW | Action.CREATE | Action.READ) |
	(ModuleName.PROMOTION | Action.READ);

// Thuộc tính cố định cho product variants
const ATTRIBUTES: Record<string, string[]> = {
	Color: ['Red', 'Blue', 'Black', 'White', 'Green', 'Yellow'],
	Size: ['XS', 'S', 'M', 'L', 'XL'],
};

// Trọng số trạng thái đơn hàng
const ORDER_STATUSES: [string, number][] = [
	['PENDING', 10],
	['PROCESSING', 10],
	['PAID', 15],
	['SHIPPED', 15],
	['DELIVERED', 30],
	['CANCELLED', 12],
	['REFUNDED', 8],
];
const PAID_STATUSES = ['PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'REFUNDED'];

const runTag = Date.now().toString(36);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) => faker.helpers.slugify(s).toLowerCase();

function pickWeighted(): string {
	const total = ORDER_STATUSES.reduce((sum, [, w]) => sum + w, 0);
	let r = Math.random() * total;
	for (const [status, weight] of ORDER_STATUSES) {
		if ((r -= weight) < 0) return status;
	}
	return ORDER_STATUSES[0][0];
}

/** Chèn nhiều dòng theo batch, tự sinh placeholder $1..$n. */
async function insertRows(client: Client, table: string, columns: string[], rows: any[][], label = table) {
	const cols = columns.map((c) => `"${c}"`).join(', ');
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const chunk = rows.slice(i, i + BATCH_SIZE);
		const placeholders = chunk.map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`);
		await client.query(`INSERT INTO ${table} (${cols}) VALUES ${placeholders.join(', ')}`, chunk.flat());
	}
	console.log(`  -> ${label}: ${rows.length}`);
}

async function seed() {
	console.log('🌱 Bắt đầu quá trình Data Seeding (chế độ thêm mới, không xóa dữ liệu cũ)...');
	const startTime = Date.now();

	const client = new Client({
		connectionString: 'postgres://root:password@localhost:5432/ecommerce',
	});
	await client.connect();
	console.log('✅ Đã kết nối tới PostgreSQL');

	try {
		await client.query('BEGIN');

		// 1. Role Customer
		console.log('\n⏳ Role...');
		const roleRes = await client.query(
			`INSERT INTO roles (name, permissions) VALUES ('Customer', $1)
			 ON CONFLICT (name) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id`,
			[CUSTOMER_PERMISSIONS],
		);
		const customerRoleId: string = roleRes.rows[0].id;

		// 2. Users + user_roles + addresses
		console.log(`\n⏳ Users (${NUM_USERS}) kèm role và địa chỉ...`);
		const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
		const users = Array.from({ length: NUM_USERS }, (_, i) => {
			const firstName = faker.person.firstName();
			const lastName = faker.person.lastName();
			const handle = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
			return {
				userId: uuidv4(),
				email: `${handle}.${runTag}${i}@example.com`,
				fullName: `${firstName} ${lastName}`,
			};
		});
		// Cột "id" của users là serial nên cần lấy lại id để gắn user_roles
		const userRowIds = new Map<string, number>();
		for (let i = 0; i < users.length; i += BATCH_SIZE) {
			const chunk = users.slice(i, i + BATCH_SIZE);
			const placeholders = chunk.map((_, r) => `($${r * 6 + 1}, $${r * 6 + 2}, $${r * 6 + 3}, $${r * 6 + 4}, $${r * 6 + 5}, $${r * 6 + 6})`);
			const res = await client.query(
				`INSERT INTO users ("userId", email, password, "fullName", permissions, "isActive")
				 VALUES ${placeholders.join(', ')} RETURNING id, "userId"`,
				chunk.flatMap((u) => [u.userId, u.email, hashedPassword, u.fullName, CUSTOMER_PERMISSIONS, true]),
			);
			res.rows.forEach((row) => userRowIds.set(row.userId, row.id));
		}
		console.log(`  -> users: ${users.length}`);

		await insertRows(client, 'user_roles', ['user_id', 'role_id'], users.map((u) => [userRowIds.get(u.userId), customerRoleId]));

		type Addr = { recipientName: string; recipientPhone: string; addressLine1: string; addressLine2: string | null; city: string; province: string; postalCode: string; country: string };
		const addressesByUser = new Map<string, Addr[]>();
		const addressRows: any[][] = [];
		for (const u of users) {
			const list: Addr[] = Array.from({ length: faker.number.int({ min: 1, max: 2 }) }, () => ({
				recipientName: u.fullName,
				recipientPhone: faker.phone.number({ style: 'national' }).slice(0, 30),
				addressLine1: faker.location.streetAddress(),
				addressLine2: Math.random() < 0.3 ? faker.location.secondaryAddress() : null,
				city: faker.location.city(),
				province: faker.location.state(),
				postalCode: faker.location.zipCode().slice(0, 20),
				country: 'Vietnam',
			}));
			addressesByUser.set(u.userId, list);
			list.forEach((a, idx) =>
				addressRows.push([uuidv4(), userRowIds.get(u.userId), a.recipientName, a.recipientPhone, a.addressLine1, a.addressLine2, a.city, a.province, a.postalCode, a.country, idx === 0]),
			);
		}
		await insertRows(
			client,
			'addresses',
			['id', 'user_id', 'recipientName', 'recipientPhone', 'addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'country', 'isDefault'],
			addressRows,
		);

		// 3. Brands, Categories
		console.log('\n⏳ Brands & Categories...');
		const brandIds = Array.from({ length: NUM_BRANDS }, () => uuidv4());
		await insertRows(
			client,
			'brands',
			['id', 'name', 'slug', 'description'],
			brandIds.map((id, i) => {
				const name = `${faker.company.name()} ${i}`;
				return [id, name, `${slugify(name)}-${runTag}-${i}`, faker.company.catchPhrase()];
			}),
		);
		const categoryIds = Array.from({ length: NUM_CATEGORIES }, () => uuidv4());
		await insertRows(
			client,
			'categories',
			['id', 'name', 'slug', 'description'],
			categoryIds.map((id, i) => {
				const name = `${faker.commerce.department()} ${runTag}-${i}`;
				return [id, name, `${slugify(name)}`, faker.lorem.sentence()];
			}),
		);

		// 4. Products
		console.log(`\n⏳ Products (${NUM_PRODUCTS})...`);
		const productIds = Array.from({ length: NUM_PRODUCTS }, () => uuidv4());
		const productPrices = new Map<string, number>();
		const productRows = productIds.map((id, i) => {
			const price = parseFloat(faker.commerce.price({ min: 10, max: 1000 }));
			productPrices.set(id, price);
			const name = `${faker.commerce.productName()} ${i}`;
			return [
				id,
				name,
				`${slugify(name)}-${runTag}-${i}`,
				faker.lorem.paragraph(),
				price,
				faker.number.int({ min: 0, max: 1000 }),
				pick(categoryIds),
				pick(brandIds),
				1, // version
			];
		});
		await insertRows(client, 'products', ['id', 'name', 'slug', 'description', 'price', 'stock', 'category_id', 'brand_id', 'version'], productRows);

		// 5. Attributes, attribute_values
		console.log('\n⏳ Attributes & Variants...');
		const attrValueIds = new Map<string, Map<string, string>>(); // attribute -> value -> id
		for (const [attrName, values] of Object.entries(ATTRIBUTES)) {
			const attrRes = await client.query(
				`INSERT INTO attributes (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
				[attrName],
			);
			const attrId: string = attrRes.rows[0].id;
			const existing = await client.query(`SELECT id, value FROM attribute_values WHERE attribute_id = $1`, [attrId]);
			const valueMap = new Map<string, string>(existing.rows.map((r) => [r.value, r.id]));
			const missing = values.filter((v) => !valueMap.has(v));
			if (missing.length) {
				const ins = await client.query(
					`INSERT INTO attribute_values (attribute_id, value) VALUES ${missing.map((_, i) => `($1, $${i + 2})`).join(', ')} RETURNING id, value`,
					[attrId, ...missing],
				);
				ins.rows.forEach((r) => valueMap.set(r.value, r.id));
			}
			attrValueIds.set(attrName, valueMap);
		}

		// 6. Product variants + bảng nối variant <-> attribute value
		const variantRows: any[][] = [];
		const variantValueRows: any[][] = [];
		const variantProducts = faker.helpers.arrayElements(productIds, NUM_PRODUCTS_WITH_VARIANTS);
		let skuCounter = 0;
		for (const productId of variantProducts) {
			const basePrice = productPrices.get(productId)!;
			const usedCombos = new Set<string>();
			for (let v = 0; v < VARIANTS_PER_PRODUCT; v++) {
				const color = pick(ATTRIBUTES.Color);
				const size = pick(ATTRIBUTES.Size);
				if (usedCombos.has(`${color}/${size}`)) continue;
				usedCombos.add(`${color}/${size}`);
				const variantId = uuidv4();
				variantRows.push([
					variantId,
					productId,
					`SKU-${runTag}-${skuCounter++}`,
					Math.random() < 0.5 ? null : round2(basePrice * faker.number.float({ min: 0.9, max: 1.3 })),
					faker.number.int({ min: 0, max: 300 }),
					1, // version
				]);
				variantValueRows.push([variantId, attrValueIds.get('Color')!.get(color)]);
				variantValueRows.push([variantId, attrValueIds.get('Size')!.get(size)]);
			}
		}
		await insertRows(client, 'product_variants', ['id', 'product_id', 'sku', 'price', 'stock', 'version'], variantRows);
		await insertRows(client, 'product_variant_attribute_values', ['variant_id', 'attribute_value_id'], variantValueRows);

		// 7. Vouchers
		console.log(`\n⏳ Vouchers (${NUM_VOUCHERS})...`);
		await insertRows(
			client,
			'vouchers',
			['code', 'discountType', 'discountValue', 'minOrderValue', 'expiresAt', 'usageLimit', 'usageCount'],
			Array.from({ length: NUM_VOUCHERS }, (_, i) => {
				const percentage = Math.random() < 0.5;
				const usageLimit = faker.number.int({ min: 50, max: 1000 });
				return [
					`SEED${runTag.toUpperCase()}${i}`,
					percentage ? 'PERCENTAGE' : 'FIXED',
					percentage ? faker.number.int({ min: 5, max: 30 }) : faker.number.int({ min: 5, max: 50 }),
					pick([0, 50, 100, 200]),
					// ~20% voucher đã hết hạn
					Math.random() < 0.2 ? faker.date.recent({ days: 60 }) : faker.date.soon({ days: 180 }),
					usageLimit,
					faker.number.int({ min: 0, max: Math.floor(usageLimit / 2) }),
				];
			}),
		);

		// 8. Orders, order_items, payment_transactions, refunds, reviews
		console.log(`\n⏳ Orders (${NUM_ORDERS}) và dữ liệu liên quan...`);
		const orderRows: any[][] = [];
		const itemRows: any[][] = [];
		const paymentRows: any[][] = [];
		const refundRows: any[][] = [];
		const reviewRows: any[][] = [];
		const reviewKeys = new Set<string>();

		for (let n = 0; n < NUM_ORDERS; n++) {
			const orderId = uuidv4();
			const user = pick(users);
			const address = pick(addressesByUser.get(user.userId)!);
			const status = pickWeighted();
			const createdAt = faker.date.recent({ days: 180 });

			const lines = Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => {
				const productId = pick(productIds);
				return { productId, quantity: faker.number.int({ min: 1, max: 3 }), unitPrice: productPrices.get(productId)! };
			});
			const subtotal = round2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
			const taxAmount = round2(subtotal * 0.1);
			const shippingFee = pick([0, 5, 10]);
			const totalAmount = round2(subtotal + taxAmount + shippingFee);

			orderRows.push([
				orderId, user.userId, subtotal, taxAmount, shippingFee, totalAmount, status,
				address.recipientName, address.recipientPhone, address.addressLine1, address.addressLine2,
				address.city, address.province, address.postalCode, address.country, createdAt, createdAt,
			]);
			lines.forEach((l) => itemRows.push([uuidv4(), orderId, l.productId, l.quantity, l.unitPrice]));

			// Thanh toán: đơn đã trả tiền -> SUCCEEDED; đơn huỷ -> thỉnh thoảng có giao dịch FAILED
			if (PAID_STATUSES.includes(status)) {
				paymentRows.push([orderId, `seed-${runTag}-${orderId}`, totalAmount, 'SUCCEEDED', null, createdAt]);
			} else if (status === 'CANCELLED' && Math.random() < 0.4) {
				paymentRows.push([orderId, `seed-${runTag}-${orderId}`, totalAmount, 'FAILED', pick(['Insufficient funds', 'Card declined', 'Payment timeout']), createdAt]);
			}

			// Refund: đơn REFUNDED -> COMPLETED; một phần đơn DELIVERED có yêu cầu hoàn tiền
			if (status === 'REFUNDED') {
				refundRows.push([orderId, totalAmount, faker.lorem.sentence(), 'COMPLETED', createdAt, createdAt]);
			} else if (status === 'DELIVERED' && Math.random() < 0.05) {
				refundRows.push([orderId, round2(lines[0].unitPrice * lines[0].quantity), faker.lorem.sentence(), pick(['PENDING', 'APPROVED', 'REJECTED']), createdAt, createdAt]);
			}

			// Review: đơn DELIVERED, ~40% có đánh giá cho 1 sản phẩm
			if (status === 'DELIVERED' && Math.random() < 0.4) {
				const line = pick(lines);
				const key = `${user.userId}|${line.productId}|${orderId}`;
				if (!reviewKeys.has(key)) {
					reviewKeys.add(key);
					reviewRows.push([user.userId, line.productId, orderId, faker.number.int({ min: 1, max: 5 }), Math.random() < 0.8 ? faker.lorem.sentences({ min: 1, max: 3 }) : null, createdAt]);
				}
			}
		}

		await insertRows(
			client,
			'orders',
			['id', 'userId', 'subtotal', 'taxAmount', 'shippingFee', 'totalAmount', 'status', 'recipientName', 'recipientPhone', 'addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'country', 'createdAt', 'updatedAt'],
			orderRows,
		);
		await insertRows(client, 'order_items', ['id', 'order_id', 'productId', 'quantity', 'unitPrice'], itemRows);
		await insertRows(client, 'payment_transactions', ['orderId', 'idempotencyKey', 'amount', 'status', 'failureReason', 'createdAt'], paymentRows);
		await insertRows(client, 'refunds', ['order_id', 'amount', 'reason', 'status', 'createdAt', 'updatedAt'], refundRows);
		await insertRows(client, 'reviews', ['userId', 'productId', 'orderId', 'rating', 'comment', 'createdAt'], reviewRows);

		await client.query('COMMIT');

		// 9. Xuất CSV sau khi commit thành công
		const csv = ['email,password', ...users.map((u) => `${u.email},${DEFAULT_PASSWORD}`)].join('\n') + '\n';
		fs.writeFileSync(CSV_PATH, csv);
		console.log(`\n📄 Đã ghi ${users.length} user vào ${CSV_PATH}`);

		console.log(`\n🎉 SEED THÀNH CÔNG! Hoàn thành trong ${(Date.now() - startTime) / 1000} giây.`);
	} catch (error) {
		await client.query('ROLLBACK');
		console.error('❌ Lỗi trong quá trình Seed (đã rollback):', error);
		process.exitCode = 1;
	} finally {
		await client.end();
	}
}

seed();
