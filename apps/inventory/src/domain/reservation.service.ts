import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { EntityManager } from 'typeorm';
import { ReserveStockDto } from '../dto/inventory.dto';
import {
	ReservationItem,
	ReservationStatus,
} from '../entities/reservation.entity';

export interface StockRow {
	id: string;
	productId: string;
	variantId: string | null;
	onHand: number;
	reserved: number;
}

export interface ReservationRow {
	id: string;
	orderId: string;
	items: ReservationItem[];
	status: ReservationStatus;
	expiresAt: Date;
}

export interface ReserveResult {
	orderId: string;
	status: ReservationStatus.RESERVED;
	expiresAt: Date;
}

export interface CheckResult {
	valid: boolean;
	status: ReservationStatus | 'NOT_FOUND';
	expiresAt: Date | null;
}

export type CommitOutcome =
	| { outcome: 'COMMITTED' | 'ALREADY_COMMITTED' }
	| { outcome: 'FAILED'; reason: string };

export type RestockOutcome = 'RELEASED' | 'RESTOCKED' | 'NOOP';

interface StockDelta {
	id: string;
	onHand: number;
	reserved: number;
}

const RESERVATION_COLUMNS = `"id", "orderId", "items", "status", "expiresAt"`;

export const stockKey = (productId: string, variantId: string | null) =>
	`${productId}:${variantId ?? ''}`;

/**
 * Logic kho dùng chung cho TCP (reserve/release/check/expire) và consumer Kafka.
 * Mọi hàm nhận `EntityManager` của transaction đang chạy; không tự mở transaction.
 *
 * Invariant: các dòng `stock_items` luôn được khoá bằng MỘT câu `ORDER BY id FOR UPDATE` trước khi ghi,
 * nên hai transaction chạm các sản phẩm giao nhau theo thứ tự khác nhau vẫn không deadlock.
 */
@Injectable()
export class ReservationService {
	private readonly logger = new Logger(ReservationService.name);

	/**
	 * Giữ hàng cho đơn, atomic: hoặc giữ đủ mọi item (và trả phần của các đơn `replaces`) hoặc không đổi gì.
	 * Idempotent theo orderId: đã RESERVED thì trả lại nguyên reservation; trạng thái khác thì 409.
	 */
	async reserve(
		m: EntityManager,
		dto: ReserveStockDto,
	): Promise<ReserveResult> {
		const existing = await this.findReservation(m, dto.orderId, true);
		if (existing) {
			if (existing.status === ReservationStatus.RESERVED) {
				return {
					orderId: existing.orderId,
					status: ReservationStatus.RESERVED,
					expiresAt: existing.expiresAt,
				};
			}
			throw conflict(`Reservation đã kết thúc (${existing.status})`);
		}

		const replaced = await this.lockReplacedReservations(
			m,
			dto.orderId,
			dto.replaces ?? [],
		);

		// Gộp số lượng theo (productId, variantId): cùng một món xuất hiện nhiều lần vẫn tính một dòng kho.
		const wanted = new Map<string, ReservationItem>();
		for (const item of dto.items) {
			const variantId = item.variantId ?? null;
			const key = stockKey(item.productId, variantId);
			const current = wanted.get(key);
			if (current) current.quantity += item.quantity;
			else
				wanted.set(key, {
					productId: item.productId,
					variantId,
					quantity: item.quantity,
				});
		}

		const released = new Map<string, number>();
		for (const reservation of replaced) {
			for (const item of reservation.items) {
				const key = stockKey(item.productId, item.variantId ?? null);
				released.set(key, (released.get(key) ?? 0) + item.quantity);
			}
		}

		const lockKeys = new Map<string, ReservationItem>(wanted);
		for (const reservation of replaced) {
			for (const item of reservation.items) {
				lockKeys.set(stockKey(item.productId, item.variantId ?? null), item);
			}
		}
		const stock = await this.lockStockRows(m, [...lockKeys.values()]);

		// Kiểm tra TOÀN BỘ trước khi ghi bất kỳ thay đổi nào.
		const unavailable: string[] = [];
		for (const [key, item] of wanted) {
			const row = stock.get(key);
			const freed = released.get(key) ?? 0;
			if (!row || row.onHand - (row.reserved - freed) < item.quantity) {
				unavailable.push(item.productId);
			}
		}
		if (unavailable.length > 0) {
			const productIds = [...new Set(unavailable)];
			throw new RpcException({
				statusCode: 409,
				message: `Không đủ tồn kho cho sản phẩm: ${productIds.join(', ')}`,
				error: 'Conflict',
				productIds,
			});
		}

		const deltas = new Map<string, number>();
		for (const [key, qty] of released) {
			const row = stock.get(key);
			if (row) deltas.set(row.id, (deltas.get(row.id) ?? 0) - qty);
		}
		for (const [key, item] of wanted) {
			const row = stock.get(key)!;
			deltas.set(row.id, (deltas.get(row.id) ?? 0) + item.quantity);
		}
		await this.applyReservedDeltas(m, deltas);

		if (replaced.length > 0) {
			await m.query(
				`UPDATE "reservations" SET "status" = $1, "updatedAt" = now() WHERE "id" = ANY($2::uuid[])`,
				[ReservationStatus.RELEASED, replaced.map((r) => r.id)],
			);
		}

		const expiresAt = new Date(Date.now() + dto.ttlSeconds * 1000);
		await m.query(
			`INSERT INTO "reservations" ("orderId", "items", "status", "expiresAt") VALUES ($1, $2::jsonb, $3, $4)`,
			[
				dto.orderId,
				JSON.stringify([...wanted.values()]),
				ReservationStatus.RESERVED,
				expiresAt,
			],
		);
		return {
			orderId: dto.orderId,
			status: ReservationStatus.RESERVED,
			expiresAt,
		};
	}

	/** Trả phần giữ của đơn. Idempotent: không phải RESERVED (hoặc không có) thì no-op. */
	async release(
		m: EntityManager,
		orderId: string,
	): Promise<{ released: boolean }> {
		const reservation = await this.findReservation(m, orderId, true);
		if (!reservation || reservation.status !== ReservationStatus.RESERVED) {
			return { released: false };
		}
		await this.giveBack(m, reservation, ReservationStatus.RELEASED);
		return { released: true };
	}

	/**
	 * Chốt giữ hàng thành trừ kho thật. Chỉ cần reservation còn RESERVED (hàng vẫn đang được giữ) nên
	 * vẫn thành công khi hơi quá `expiresAt` mà job dọn chưa chạy. COMMITTED lặp lại là idempotent.
	 * RELEASED/EXPIRED/RESTOCKED/không có => FAILED (kho không đổi).
	 */
	async commit(m: EntityManager, orderId: string): Promise<CommitOutcome> {
		const reservation = await this.findReservation(m, orderId, true);
		if (!reservation) {
			return { outcome: 'FAILED', reason: 'RESERVATION_NOT_FOUND' };
		}
		if (reservation.status === ReservationStatus.COMMITTED) {
			return { outcome: 'ALREADY_COMMITTED' };
		}
		if (reservation.status !== ReservationStatus.RESERVED) {
			return {
				outcome: 'FAILED',
				reason: `RESERVATION_${reservation.status}`,
			};
		}

		const stock = await this.lockStockRows(m, reservation.items);
		const rows = reservation.items.map((item) => {
			const row = stock.get(stockKey(item.productId, item.variantId ?? null));
			// Reserve yêu cầu dòng kho tồn tại; thiếu là lỗi dữ liệu nên để consumer retry/DLQ thay vì commit thiếu.
			if (!row) {
				throw new Error(
					`Dòng kho không tồn tại khi commit đơn ${orderId}: ${item.productId}`,
				);
			}
			return { row, quantity: item.quantity };
		});
		await this.applyStockDeltas(
			m,
			rows.map(({ row, quantity }) => ({
				id: row.id,
				onHand: -quantity,
				reserved: -quantity,
			})),
		);
		await this.setStatus(m, reservation.id, ReservationStatus.COMMITTED);
		return { outcome: 'COMMITTED' };
	}

	/**
	 * Hoàn kho khi huỷ đơn: RESERVED => như release; COMMITTED => cộng lại `onHand` và đánh dấu RESTOCKED
	 * (lần sau no-op). Trạng thái khác/không có => no-op. Restock tới trước Commit (cùng partition key nên
	 * hiếm) chỉ release; Commit đến sau sẽ thấy RELEASED và báo FAILED.
	 */
	async restock(m: EntityManager, orderId: string): Promise<RestockOutcome> {
		const reservation = await this.findReservation(m, orderId, true);
		if (!reservation) return 'NOOP';
		if (reservation.status === ReservationStatus.RESERVED) {
			await this.giveBack(m, reservation, ReservationStatus.RELEASED);
			return 'RELEASED';
		}
		if (reservation.status !== ReservationStatus.COMMITTED) return 'NOOP';

		const stock = await this.lockStockRows(m, reservation.items);
		const deltas: StockDelta[] = [];
		for (const item of reservation.items) {
			const row = stock.get(stockKey(item.productId, item.variantId ?? null));
			if (!row) {
				throw new Error(
					`Dòng kho không tồn tại khi restock đơn ${orderId}: ${item.productId}`,
				);
			}
			deltas.push({ id: row.id, onHand: item.quantity, reserved: 0 });
		}
		await this.applyStockDeltas(m, deltas);
		await this.setStatus(m, reservation.id, ReservationStatus.RESTOCKED);
		return 'RESTOCKED';
	}

	/** Cộng/trừ `onHand` và `reserved` theo id tăng dần (cùng thứ tự với lúc khoá), gộp delta cùng dòng. */
	private async applyStockDeltas(
		m: EntityManager,
		deltas: StockDelta[],
	): Promise<void> {
		const merged = new Map<string, StockDelta>();
		for (const d of deltas) {
			const current = merged.get(d.id) ?? { id: d.id, onHand: 0, reserved: 0 };
			current.onHand += d.onHand;
			current.reserved += d.reserved;
			merged.set(d.id, current);
		}
		const ordered = [...merged.values()].sort((a, b) =>
			a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
		);
		for (const d of ordered) {
			await m.query(
				`UPDATE "stock_items" SET "onHand" = "onHand" + $1, "reserved" = "reserved" + $2, "updatedAt" = now() WHERE "id" = $3`,
				[d.onHand, d.reserved, d.id],
			);
		}
	}

	/** Chỉ đọc, không khoá. valid = RESERVED && now < expiresAt. */
	async check(
		m: EntityManager,
		orderId: string,
		now: Date = new Date(),
	): Promise<CheckResult> {
		const reservation = await this.findReservation(m, orderId, false);
		if (!reservation) {
			return { valid: false, status: 'NOT_FOUND', expiresAt: null };
		}
		const expiresAt = new Date(reservation.expiresAt);
		return {
			valid:
				reservation.status === ReservationStatus.RESERVED &&
				now.getTime() < expiresAt.getTime(),
			status: reservation.status,
			expiresAt,
		};
	}

	/** Id các reservation RESERVED đã quá `threshold` (đọc không khoá; khoá thật ở `expireOne`). */
	async findExpiredIds(
		m: EntityManager,
		threshold: Date,
		limit: number,
	): Promise<string[]> {
		const rows: { id: string }[] = await m.query(
			`SELECT "id" FROM "reservations" WHERE "status" = $1 AND "expiresAt" < $2 ORDER BY "expiresAt" LIMIT $3`,
			[ReservationStatus.RESERVED, threshold, limit],
		);
		return rows.map((r) => r.id);
	}

	/**
	 * Hết hạn một reservation và trả phần giữ. `SKIP LOCKED`: nếu đơn đang bị transaction khác xử lý
	 * (commit/release) thì bỏ qua, lượt quét sau sẽ thấy trạng thái mới. Trả true nếu thực sự hết hạn.
	 */
	async expireOne(
		m: EntityManager,
		id: string,
		threshold: Date,
	): Promise<boolean> {
		const rows: ReservationRow[] = await m.query(
			`SELECT ${RESERVATION_COLUMNS} FROM "reservations"
			 WHERE "id" = $1 AND "status" = $2 AND "expiresAt" < $3 FOR UPDATE SKIP LOCKED`,
			[id, ReservationStatus.RESERVED, threshold],
		);
		if (rows.length === 0) return false;
		await this.giveBack(m, rows[0], ReservationStatus.EXPIRED);
		return true;
	}

	/** Lấy reservation theo orderId; `lock` = true thì `FOR UPDATE`. */
	async findReservation(
		m: EntityManager,
		orderId: string,
		lock: boolean,
	): Promise<ReservationRow | undefined> {
		const rows: ReservationRow[] = await m.query(
			`SELECT ${RESERVATION_COLUMNS} FROM "reservations" WHERE "orderId" = $1${lock ? ' FOR UPDATE' : ''}`,
			[orderId],
		);
		return rows[0];
	}

	/** Khoá mọi dòng kho liên quan bằng một câu duy nhất, theo id tăng dần. */
	async lockStockRows(
		m: EntityManager,
		items: Pick<ReservationItem, 'productId' | 'variantId'>[],
	): Promise<Map<string, StockRow>> {
		const result = new Map<string, StockRow>();
		if (items.length === 0) return result;
		const rows: StockRow[] = await m.query(
			`SELECT s."id", s."productId", s."variantId", s."onHand", s."reserved"
			 FROM "stock_items" s
			 JOIN unnest($1::uuid[], $2::uuid[]) AS k("productId", "variantId")
			   ON s."productId" = k."productId" AND s."variantId" IS NOT DISTINCT FROM k."variantId"
			 ORDER BY s."id" FOR UPDATE OF s`,
			[items.map((i) => i.productId), items.map((i) => i.variantId ?? null)],
		);
		for (const row of rows) {
			result.set(stockKey(row.productId, row.variantId), row);
		}
		return result;
	}

	/** Cộng/trừ `reserved` theo id tăng dần (cùng thứ tự với lúc khoá). */
	async applyReservedDeltas(
		m: EntityManager,
		deltas: Map<string, number>,
	): Promise<void> {
		const ordered = [...deltas.entries()]
			.filter(([, delta]) => delta !== 0)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		for (const [id, delta] of ordered) {
			await m.query(
				`UPDATE "stock_items" SET "reserved" = "reserved" + $1, "updatedAt" = now() WHERE "id" = $2`,
				[delta, id],
			);
		}
	}

	/** Trả `reserved` của một reservation đang RESERVED rồi đổi sang `status` đích. */
	async giveBack(
		m: EntityManager,
		reservation: ReservationRow,
		status: ReservationStatus,
	): Promise<void> {
		const stock = await this.lockStockRows(m, reservation.items);
		const deltas = new Map<string, number>();
		for (const item of reservation.items) {
			const row = stock.get(stockKey(item.productId, item.variantId ?? null));
			if (!row) {
				// Không thể xảy ra vì reserve yêu cầu dòng kho tồn tại; log để không chặn việc dọn các item còn lại.
				this.logger.error(
					`Reservation ${reservation.orderId} tham chiếu dòng kho không tồn tại: ${item.productId}`,
				);
				continue;
			}
			deltas.set(row.id, (deltas.get(row.id) ?? 0) - item.quantity);
		}
		await this.applyReservedDeltas(m, deltas);
		await this.setStatus(m, reservation.id, status);
	}

	async setStatus(
		m: EntityManager,
		id: string,
		status: ReservationStatus,
	): Promise<void> {
		await m.query(
			`UPDATE "reservations" SET "status" = $1, "updatedAt" = now() WHERE "id" = $2`,
			[status, id],
		);
	}

	private async lockReplacedReservations(
		m: EntityManager,
		orderId: string,
		replaces: string[],
	): Promise<ReservationRow[]> {
		const ids = [...new Set(replaces)].filter((id) => id !== orderId);
		if (ids.length === 0) return [];
		return m.query(
			`SELECT ${RESERVATION_COLUMNS} FROM "reservations"
			 WHERE "orderId" = ANY($1::uuid[]) AND "status" = $2 ORDER BY "id" FOR UPDATE`,
			[ids, ReservationStatus.RESERVED],
		);
	}
}

function conflict(message: string): RpcException {
	return new RpcException({ statusCode: 409, message, error: 'Conflict' });
}
