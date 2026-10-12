import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropProductVersionColumnDefault1790332659351 implements MigrationInterface {
	name = 'DropProductVersionColumnDefault1790332659351';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "products" ALTER COLUMN "version" DROP DEFAULT`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "products" ALTER COLUMN "version" SET DEFAULT '1'`,
		);
	}
}
