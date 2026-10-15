import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chốt state machine đơn và quyền sở hữu tồn kho sau khi luồng Saga đồng bộ bị gỡ:
 *  - orders.status chỉ còn các trạng thái hiện hành; đơn cũ PENDING/PROCESSING chuyển sang PENDING_PAYMENT
 *    với expiresAt = now() để scheduler huỷ ngay (đơn PROCESSING cũ đã thu tiền nhưng không có reservation
 *    nên không thể đi tiếp; chấp nhận cho dữ liệu seed/dev).
 *  - Đơn DELIVERED cũ chưa có deliveredAt được gán = updatedAt để tự động COMPLETED.
 *  - Inventory là nguồn sự thật của tồn kho: bỏ cột stock của products/product_variants.
 *  - Bỏ default tạm của outbox.topic/source: OutboxWriter luôn điền hai cột này.
 *
 * Postgres cấm dùng giá trị enum vừa ADD VALUE trong cùng transaction, nên cột được đổi sang text trước,
 * chuyển dữ liệu bằng so sánh chuỗi, rồi mới tạo enum mới và ép kiểu lại. Mọi bước idempotent
 * (DB dựng bằng schema:sync từ entity mới đã ở trạng thái đích).
 */
export class FinalizeOrderStatusAndStockOwnership1791879000000 implements MigrationInterface {
	name = 'FinalizeOrderStatusAndStockOwnership1791879000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// 1. Tách khỏi enum cũ để dữ liệu được sửa bằng so sánh chuỗi.
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" TYPE text USING "status"::text`,
		);

		// 2-3. Chuyển dữ liệu của luồng cũ.
		await queryRunner.query(
			`UPDATE "orders"
				SET "status" = 'PENDING_PAYMENT', "expiresAt" = COALESCE("expiresAt", now())
				WHERE "status" IN ('PENDING', 'PROCESSING')`,
		);
		await queryRunner.query(
			`UPDATE "orders" SET "deliveredAt" = "updatedAt"
				WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NULL`,
		);

		// 4. Enum chốt (không còn PENDING/PROCESSING), default mới.
		await queryRunner.query(
			`DROP TYPE IF EXISTS "public"."orders_status_enum"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."orders_status_enum" AS ENUM('PENDING_PAYMENT', 'PAID', 'FULFILLING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDING', 'REFUNDED')`,
		);
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum" USING "status"::"public"."orders_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT'`,
		);

		// 5. Trước khi bỏ cột, bù các sản phẩm/variant chưa có dòng ở Inventory (tạo sau lần sao chép đầu tiên).
		// Không ghi đè dòng đã có để không mất tồn đã chỉnh ở Inventory.
		await queryRunner.query(`
			DO $$ BEGIN
				IF EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock'
				) THEN
					INSERT INTO "stock_items" ("productId", "variantId", "onHand")
					SELECT "id", NULL, GREATEST("stock", 0) FROM "products" WHERE "deletedAt" IS NULL
					ON CONFLICT DO NOTHING;
				END IF;
				IF EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = 'product_variants' AND column_name = 'stock'
				) THEN
					INSERT INTO "stock_items" ("productId", "variantId", "onHand")
					SELECT "product_id", "id", GREATEST("stock", 0) FROM "product_variants" WHERE "deletedAt" IS NULL
					ON CONFLICT DO NOTHING;
				END IF;
			END $$;
		`);
		await queryRunner.query(
			`ALTER TABLE "products" DROP COLUMN IF EXISTS "stock"`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "stock"`,
		);

		// 6. Outbox: topic/source do OutboxWriter điền, không dựa vào default.
		await queryRunner.query(
			`ALTER TABLE "outbox" ALTER COLUMN "topic" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ALTER COLUMN "source" DROP DEFAULT`,
		);
	}

	/**
	 * Khôi phục schema như trước migration này: cột stock (sao chép ngược từ stock_items), enum status
	 * có đủ giá trị cũ lẫn mới (PENDING, PROCESSING cùng 9 trạng thái hiện hành) nên mọi dòng hiện có vẫn hợp lệ
	 * và không cần ánh xạ lại, default status/outbox cũ. Không hoàn nguyên được việc đã chuyển
	 * PENDING/PROCESSING -> PENDING_PAYMENT và expiresAt/deliveredAt đã gán.
	 */
	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "outbox" ALTER COLUMN "source" SET DEFAULT 'orders'`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ALTER COLUMN "topic" SET DEFAULT 'order-events'`,
		);

		await queryRunner.query(
			`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock" integer NOT NULL DEFAULT 0`,
		);
		await queryRunner.query(
			`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "stock" integer NOT NULL DEFAULT 0`,
		);
		await queryRunner.query(
			`UPDATE "products" p SET "stock" = s."onHand"
				FROM "stock_items" s WHERE s."productId" = p."id" AND s."variantId" IS NULL`,
		);
		await queryRunner.query(
			`UPDATE "product_variants" v SET "stock" = s."onHand"
				FROM "stock_items" s WHERE s."variantId" = v."id"`,
		);

		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`,
		);
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" TYPE text USING "status"::text`,
		);
		await queryRunner.query(
			`DROP TYPE IF EXISTS "public"."orders_status_enum"`,
		);
		await queryRunner.query(
			`CREATE TYPE "public"."orders_status_enum" AS ENUM('PENDING', 'PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'PENDING_PAYMENT', 'FULFILLING', 'COMPLETED', 'REFUNDING')`,
		);
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum" USING "status"::"public"."orders_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
		);
	}
}
