import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserAvatarUrl1790335853906 implements MigrationInterface {
    name = 'AddUserAvatarUrl1790335853906'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "avatarUrl" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatarUrl"`);
    }

}
