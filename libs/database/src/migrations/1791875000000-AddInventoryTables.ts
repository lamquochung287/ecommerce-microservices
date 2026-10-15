import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tạo bảng tồn kho của Inventory và sao chép tồn hiện có từ products/product_variants.
 * Idempotent: DB dựng bằng schema:sync có thể đã có sẵn bảng/enum nên mọi bước đều có guard;
 * index unique NULLS NOT DISTINCT (PG15) và CHECK được thêm riêng vì TypeORM không sinh ra chúng.
 * `down` không đụng tới stock bên Product (vẫn là nguồn cũ cho tới khi Inventory thay thế hẳn).
 */
export class AddInventoryTables1791875000000 implements MigrationInterface {
	name = 'AddInventoryTables1791875000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservations_status_enum') THEN
					CREATE TYPE "reservations_status_enum" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED', 'RESTOCKED');
				END IF;
			END $$;
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "stock_items" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"productId" uuid NOT NULL,
				"variantId" uuid,
				"onHand" integer NOT NULL,
				"reserved" integer NOT NULL DEFAULT 0,
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_stock_items_id" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stock_items_product_variant" ON "stock_items" ("productId", "variantId") NULLS NOT DISTINCT`,
		);
		await queryRunner.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_stock_items_reserved') THEN
					ALTER TABLE "stock_items" ADD CONSTRAINT "CHK_stock_items_reserved"
						CHECK ("reserved" >= 0 AND "onHand" >= "reserved");
				END IF;
			END $$;
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "reservations" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"orderId" uuid NOT NULL,
				"items" jsonb NOT NULL,
				"status" "reservations_status_enum" NOT NULL DEFAULT 'RESERVED',
				"expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_reservations_id" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_reservations_orderId" ON "reservations" ("orderId")`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_reservations_status_expiresAt" ON "reservations" ("status", "expiresAt")`,
		);

		// Sao chép tồn hiện có; GREATEST vì stock âm sẽ vi phạm CHECK. Chạy lại không ghi đè tồn đã chỉnh ở Inventory.
		await queryRunner.query(`
			INSERT INTO "stock_items" ("productId", "variantId", "onHand")
			SELECT "id", NULL, GREATEST("stock", 0) FROM "products" WHERE "deletedAt" IS NULL
			ON CONFLICT DO NOTHING
		`);
		await queryRunner.query(`
			INSERT INTO "stock_items" ("productId", "variantId", "onHand")
			SELECT "product_id", "id", GREATEST("stock", 0) FROM "product_variants" WHERE "deletedAt" IS NULL
			ON CONFLICT DO NOTHING
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "reservations"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "stock_items"`);
		await queryRunner.query(`DROP TYPE IF EXISTS "reservations_status_enum"`);
	}
}
