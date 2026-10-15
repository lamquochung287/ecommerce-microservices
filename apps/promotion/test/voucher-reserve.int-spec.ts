import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { describeWithDb } from '../../../libs/database/test/integration-data-source';
import { ReleaseVoucherCommand } from '../src/commands/release-voucher.command';
import { ReserveVoucherCommand } from '../src/commands/reserve-voucher.command';
import { ReleaseVoucherHandler } from '../src/commands/handlers/release-voucher.handler';
import { ReserveVoucherHandler } from '../src/commands/handlers/reserve-voucher.handler';
import { ConfirmVoucherHandler } from '../src/commands/handlers/confirm-voucher.handler';
import { ConfirmVoucherCommand } from '../src/commands/confirm-voucher.command';

const USER_ID = randomUUID();

async function createVoucher(ds: DataSource, usageLimit: number) {
	const code = `INT-${randomUUID().slice(0, 8)}`;
	await ds.query(
		`INSERT INTO "vouchers" ("code", "discountType", "discountValue", "minOrderValue", "expiresAt", "usageLimit", "usageCount")
		 VALUES ($1, 'FIXED', 10, 0, now() + interval '1 day', $2, 0)`,
		[code, usageLimit],
	);
	return code;
}

async function usageCountOf(ds: DataSource, code: string) {
	const rows: { usageCount: number }[] = await ds.query(
		`SELECT "usageCount" FROM "vouchers" WHERE "code" = $1`,
		[code],
	);
	return rows[0].usageCount;
}

async function statusOf(ds: DataSource, orderId: string) {
	const rows: { status: string }[] = await ds.query(
		`SELECT "status" FROM "voucher_redemptions" WHERE "orderId" = $1`,
		[orderId],
	);
	return rows[0]?.status;
}

async function cleanup(ds: DataSource, code: string) {
	await ds.query(`DELETE FROM "voucher_redemptions" WHERE "code" = $1`, [code]);
	await ds.query(`DELETE FROM "vouchers" WHERE "code" = $1`, [code]);
}

const reserveCmd = (code: string, orderId: string) =>
	new ReserveVoucherCommand({
		code,
		orderId,
		userId: USER_ID,
		orderValue: 100,
	});

describeWithDb('Voucher reserve (Postgres)', ({ it }) => {
	it('usageLimit=1, hai reserve song song cho hai đơn khác nhau: đúng một thành công', async (ds) => {
		const code = await createVoucher(ds, 1);
		const handler = new ReserveVoucherHandler(ds);
		try {
			const results = await Promise.allSettled([
				handler.execute(reserveCmd(code, randomUUID())),
				handler.execute(reserveCmd(code, randomUUID())),
			]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
			expect(await usageCountOf(ds, code)).toBe(1);
		} finally {
			await cleanup(ds, code);
		}
	});

	it('reserve lặp cùng orderId song song: usageCount chỉ tăng 1, một redemption', async (ds) => {
		const code = await createVoucher(ds, 5);
		const handler = new ReserveVoucherHandler(ds);
		const orderId = randomUUID();
		try {
			await Promise.all([
				handler.execute(reserveCmd(code, orderId)),
				handler.execute(reserveCmd(code, orderId)),
			]);

			expect(await usageCountOf(ds, code)).toBe(1);
			const rows: { count: string }[] = await ds.query(
				`SELECT count(*) FROM "voucher_redemptions" WHERE "orderId" = $1`,
				[orderId],
			);
			expect(rows[0].count).toBe('1');
		} finally {
			await cleanup(ds, code);
		}
	});

	it('release trả lượt cho đơn khác; release lặp là no-op', async (ds) => {
		const code = await createVoucher(ds, 1);
		const reserve = new ReserveVoucherHandler(ds);
		const release = new ReleaseVoucherHandler(ds);
		const first = randomUUID();
		try {
			await reserve.execute(reserveCmd(code, first));
			await release.execute(new ReleaseVoucherCommand(first));
			await release.execute(new ReleaseVoucherCommand(first));

			expect(await statusOf(ds, first)).toBe('RELEASED');
			expect(await usageCountOf(ds, code)).toBe(0);
			await expect(
				reserve.execute(reserveCmd(code, randomUUID())),
			).resolves.toMatchObject({ code });
		} finally {
			await cleanup(ds, code);
		}
	});

	it('confirm rồi release: lượt không được trả', async (ds) => {
		const code = await createVoucher(ds, 2);
		const reserve = new ReserveVoucherHandler(ds);
		const release = new ReleaseVoucherHandler(ds);
		const confirm = new ConfirmVoucherHandler();
		const orderId = randomUUID();
		try {
			await reserve.execute(reserveCmd(code, orderId));
			await ds.transaction((manager) =>
				confirm.execute(new ConfirmVoucherCommand(manager, orderId)),
			);
			await release.execute(new ReleaseVoucherCommand(orderId));

			expect(await statusOf(ds, orderId)).toBe('CONFIRMED');
			expect(await usageCountOf(ds, code)).toBe(1);
		} finally {
			await cleanup(ds, code);
		}
	});

	it('release và confirm song song cho cùng đơn: kết quả nhất quán với trạng thái cuối', async (ds) => {
		const code = await createVoucher(ds, 2);
		const reserve = new ReserveVoucherHandler(ds);
		const release = new ReleaseVoucherHandler(ds);
		const confirm = new ConfirmVoucherHandler();
		const orderId = randomUUID();
		try {
			await reserve.execute(reserveCmd(code, orderId));
			await Promise.all([
				release.execute(new ReleaseVoucherCommand(orderId)),
				ds.transaction((manager) =>
					confirm.execute(new ConfirmVoucherCommand(manager, orderId)),
				),
			]);

			const status = await statusOf(ds, orderId);
			const usage = await usageCountOf(ds, code);
			// RELEASED <=> đã trả lượt; CONFIRMED <=> lượt vẫn bị giữ.
			expect(usage).toBe(status === 'RELEASED' ? 0 : 1);
		} finally {
			await cleanup(ds, code);
		}
	});
});
