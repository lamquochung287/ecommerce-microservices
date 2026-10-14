import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductsCreatedAtIndex1791874500000 implements MigrationInterface {
	name = 'AddProductsCreatedAtIndex1791874500000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_products_created_at_id" ON "products" ("createdAt" DESC, "id") WHERE "deletedAt" IS NULL`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "public"."IDX_products_created_at_id"`);
	}
}
