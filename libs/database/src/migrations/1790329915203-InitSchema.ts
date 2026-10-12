import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1790329915203 implements MigrationInterface {
	name = 'InitSchema1790329915203';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX "public"."IDX_63fcb3d8806a6efd53dbc67430"`,
		);
		await queryRunner.query(`ALTER TABLE "users" ADD "deletedAt" TIMESTAMP`);
		await queryRunner.query(`ALTER TABLE "orders" ADD "deletedAt" TIMESTAMP`);
		await queryRunner.query(`ALTER TABLE "products" ADD "deletedAt" TIMESTAMP`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "deletedAt"`);
		await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "deletedAt"`);
		await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
		await queryRunner.query(
			`CREATE INDEX "IDX_63fcb3d8806a6efd53dbc67430" ON "products" ("createdAt") `,
		);
	}
}
