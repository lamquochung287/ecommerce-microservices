import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * DataSource cho integration test: DB riêng (INT_DB_NAME, mặc định ecommerce_test), không chạy migration
 * (schema do `loadtest/migrate.js` dựng trước), nạp entity của cả apps và libs.
 */
export function createIntegrationDataSource(): DataSource {
	return new DataSource({
		type: 'postgres',
		host: process.env.DB_HOST || 'localhost',
		port: Number(process.env.DB_PORT) || 5432,
		username: process.env.DB_USER || 'root',
		password: process.env.DB_PASSWORD || 'password',
		database: process.env.INT_DB_NAME || 'ecommerce_test',
		// Loại entity outbox cũ của app: bảng outbox do libs/messaging sở hữu.
		entities: [
			__dirname + '/../../../apps/**/src/**/!(outbox).entity{.ts,.js}',
			__dirname + '/../../../libs/**/src/**/*.entity{.ts,.js}',
		],
		synchronize: false,
		migrationsRun: false,
		extra: { connectionTimeoutMillis: 3000 },
	});
}

export interface DbSuite {
	/** Test chạy với DataSource đã kết nối; tự bỏ qua (pass rỗng, có log) nếu không có Postgres. */
	it: (title: string, body: (dataSource: DataSource) => Promise<void>) => void;
}

/**
 * Nhóm test cần Postgres. Không kết nối được thì các test bên trong không chạy và log rõ lý do,
 * để máy không có Docker vẫn chạy được toàn bộ bộ test.
 */
export function describeWithDb(
	name: string,
	define: (suite: DbSuite) => void,
	setup?: (dataSource: DataSource) => Promise<void>,
): void {
	describe(name, () => {
		const dataSource = createIntegrationDataSource();
		let available = false;

		beforeAll(async () => {
			try {
				await dataSource.initialize();
				available = true;
				if (setup) await setup(dataSource);
			} catch (err) {
				console.warn(
					`[integration] bỏ qua "${name}": không dùng được Postgres (${(err as Error).message})`,
				);
			}
		});

		afterAll(async () => {
			if (dataSource.isInitialized) await dataSource.destroy();
		});

		define({
			it: (title, body) =>
				it(title, async () => {
					if (!available) return;
					await body(dataSource);
				}),
		});
	});
}
