import { EntityManager } from 'typeorm';

export type QueryRoute = [RegExp, (params: unknown[]) => unknown];

export interface RecordedQuery {
	sql: string;
	params: unknown[];
}

/**
 * EntityManager giả cho unit test: `query` trả kết quả theo route đầu tiên khớp SQL (mặc định `[]`)
 * và ghi lại mọi câu lệnh theo thứ tự để test kiểm tra thứ tự ghi.
 */
export function createMockManager(routes: QueryRoute[]) {
	const calls: RecordedQuery[] = [];
	const query = jest.fn((sql: string, params: unknown[] = []) => {
		calls.push({ sql, params });
		for (const [pattern, respond] of routes) {
			if (pattern.test(sql)) return Promise.resolve(respond(params));
		}
		return Promise.resolve([]);
	});
	return {
		manager: { query } as unknown as EntityManager,
		query,
		calls,
		callsMatching: (pattern: RegExp) =>
			calls.filter((c) => pattern.test(c.sql)),
	};
}

/** DataSource giả: `transaction` chạy callback với chính manager truyền vào. */
export function createMockDataSource(manager: EntityManager) {
	return {
		manager,
		transaction: jest.fn((cb: (m: EntityManager) => unknown) => cb(manager)),
	};
}

export const SQL = {
	findReservation: /FROM "reservations" WHERE "orderId" = \$1/,
	replacedReservations: /"orderId" = ANY/,
	lockStock: /FROM "stock_items" s/,
	updateStock: /UPDATE "stock_items" SET "reserved"/,
	updateReservationStatus: /UPDATE "reservations" SET "status"/,
	insertReservation: /INSERT INTO "reservations"/,
};
