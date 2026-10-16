import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VERIFY_TOKEN tra user theo users.userId (UUID) ở mọi request qua Gateway nhưng cột này chưa có index,
 * nên mỗi lần là một Seq Scan. Thêm unique index; idempotent (DB dựng bằng schema:sync từ entity mới đã có index).
 */
export class AddUsersUserIdIndex1791880000000 implements MigrationInterface {
	name = 'AddUsersUserIdIndex1791880000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_userId" ON "users" ("userId")`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_userId"`);
	}
}
