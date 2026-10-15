import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mở rộng bảng orders cho vòng đời mới: khoá lạc quan (version), hạn thanh toán, thông tin thanh toán/giao hàng/hoàn tiền.
 * Giá trị enum mới chỉ được thêm, không dùng trong migration này: Postgres cấm dùng giá trị enum vừa
 * ADD VALUE trong cùng transaction. Việc chuyển dữ liệu sang trạng thái mới thuộc migration sau.
 */
export class AddOrderLifecycleColumns1791874800000 implements MigrationInterface {
	name = 'AddOrderLifecycleColumns1791874800000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		for (const value of [
			'PENDING_PAYMENT',
			'FULFILLING',
			'COMPLETED',
			'REFUNDING',
		]) {
			await queryRunner.query(
				`ALTER TYPE "public"."orders_status_enum" ADD VALUE IF NOT EXISTS '${value}'`,
			);
		}

		await queryRunner.query(`DO $$ BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orders_refundstatus_enum') THEN
				CREATE TYPE "public"."orders_refundstatus_enum" AS ENUM('NONE', 'PENDING', 'SUCCEEDED', 'FAILED');
			END IF;
		END $$;`);

		await queryRunner.query(
			`ALTER TABLE "orders"
				ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1,
				ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITH TIME ZONE,
				ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP WITH TIME ZONE,
				ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP WITH TIME ZONE,
				ADD COLUMN IF NOT EXISTS "cancelReason" character varying(40),
				ADD COLUMN IF NOT EXISTS "refundStatus" "public"."orders_refundstatus_enum" NOT NULL DEFAULT 'NONE',
				ADD COLUMN IF NOT EXISTS "refundedAmount" numeric(10,2),
				ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP WITH TIME ZONE,
				ADD COLUMN IF NOT EXISTS "paymentIntentId" uuid,
				ADD COLUMN IF NOT EXISTS "paymentCheckoutUrl" character varying(500),
				ADD COLUMN IF NOT EXISTS "trackingCode" character varying(100),
				ADD COLUMN IF NOT EXISTS "voucherCode" character varying(50),
				ADD COLUMN IF NOT EXISTS "discountAmount" numeric(10,2) NOT NULL DEFAULT 0`,
		);

		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_orders_status_expires" ON "orders" ("status", "expiresAt")`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_orders_status_delivered" ON "orders" ("status", "deliveredAt")`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_orders_user_status" ON "orders" ("userId", "status")`,
		);
	}

	/**
	 * Các giá trị đã ADD VALUE vào orders_status_enum không gỡ lại được (Postgres không hỗ trợ);
	 * giá trị thừa vô hại với code cũ.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_user_status"`);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_orders_status_delivered"`,
		);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_status_expires"`);
		await queryRunner.query(
			`ALTER TABLE "orders"
				DROP COLUMN IF EXISTS "discountAmount",
				DROP COLUMN IF EXISTS "voucherCode",
				DROP COLUMN IF EXISTS "trackingCode",
				DROP COLUMN IF EXISTS "paymentCheckoutUrl",
				DROP COLUMN IF EXISTS "paymentIntentId",
				DROP COLUMN IF EXISTS "refundedAt",
				DROP COLUMN IF EXISTS "refundedAmount",
				DROP COLUMN IF EXISTS "refundStatus",
				DROP COLUMN IF EXISTS "cancelReason",
				DROP COLUMN IF EXISTS "deliveredAt",
				DROP COLUMN IF EXISTS "paidAt",
				DROP COLUMN IF EXISTS "expiresAt",
				DROP COLUMN IF EXISTS "version"`,
		);
		await queryRunner.query(
			`DROP TYPE IF EXISTS "public"."orders_refundstatus_enum"`,
		);
	}
}
