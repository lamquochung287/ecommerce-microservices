import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tạo bảng lượt dùng voucher theo đơn (mỗi đơn tối đa một lượt, orderId unique).
 * Idempotent: DB dựng bằng schema:sync có thể đã có sẵn enum/bảng nên mọi bước đều có guard.
 */
export class AddVoucherRedemptions1791878000000 implements MigrationInterface {
	name = 'AddVoucherRedemptions1791878000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'voucher_redemptions_status_enum') THEN
					CREATE TYPE "voucher_redemptions_status_enum" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED');
				END IF;
			END $$;
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "voucher_redemptions" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"voucherId" uuid NOT NULL,
				"code" character varying(50) NOT NULL,
				"orderId" uuid NOT NULL,
				"userId" uuid NOT NULL,
				"discountAmount" numeric(10,2) NOT NULL,
				"status" "voucher_redemptions_status_enum" NOT NULL DEFAULT 'RESERVED',
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_voucher_redemptions_id" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_voucher_redemptions_orderId" ON "voucher_redemptions" ("orderId")`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_voucher_redemptions_voucherId" ON "voucher_redemptions" ("voucherId")`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "voucher_redemptions"`);
		await queryRunner.query(
			`DROP TYPE IF EXISTS "voucher_redemptions_status_enum"`,
		);
	}
}
