import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * payment_transactions trở thành payment intent (PENDING/CANCELLED, hạn, URL, thời điểm trả) và thêm bảng
 * payment_refunds (unique orderId: hoàn cả đơn đúng một lần).
 * Idempotent: DB dựng bằng schema:sync có thể đã có sẵn cột/bảng/enum. `ADD VALUE` không dùng giá trị mới
 * trong cùng migration nên chạy được trong transaction của PG15. `down` không gỡ giá trị enum đã thêm.
 */
export class AddPaymentIntentAndRefund1791876000000 implements MigrationInterface {
	name = 'AddPaymentIntentAndRefund1791876000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TYPE "payment_transactions_status_enum" ADD VALUE IF NOT EXISTS 'PENDING'`,
		);
		await queryRunner.query(
			`ALTER TYPE "payment_transactions_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`,
		);

		await queryRunner.query(
			`ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITH TIME ZONE`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "checkoutUrl" character varying(500)`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP WITH TIME ZONE`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_payment_transactions_orderId" ON "payment_transactions" ("orderId")`,
		);

		await queryRunner.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_refunds_status_enum') THEN
					CREATE TYPE "payment_refunds_status_enum" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
				END IF;
			END $$;
		`);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "payment_refunds" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"orderId" uuid NOT NULL,
				"transactionId" uuid,
				"amount" numeric(10,2) NOT NULL,
				"status" "payment_refunds_status_enum" NOT NULL,
				"reason" character varying(255),
				"failureReason" character varying(255),
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "UQ_payment_refunds_orderId" UNIQUE ("orderId"),
				CONSTRAINT "PK_payment_refunds_id" PRIMARY KEY ("id")
			)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "payment_refunds"`);
		await queryRunner.query(
			`DROP TYPE IF EXISTS "payment_refunds_status_enum"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "IDX_payment_transactions_orderId"`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "updatedAt"`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "paidAt"`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "checkoutUrl"`,
		);
		await queryRunner.query(
			`ALTER TABLE "payment_transactions" DROP COLUMN IF EXISTS "expiresAt"`,
		);
	}
}
