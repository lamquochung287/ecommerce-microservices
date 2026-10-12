import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxTable1790331499374 implements MigrationInterface {
	name = 'AddOutboxTable1790331499374';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TYPE "public"."outbox_status_enum" AS ENUM('PENDING', 'PUBLISHED', 'FAILED')`,
		);
		await queryRunner.query(
			`CREATE TABLE "outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventType" character varying(255) NOT NULL, "payload" jsonb NOT NULL, "status" "public"."outbox_status_enum" NOT NULL DEFAULT 'PENDING', "retryCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "publishedAt" TIMESTAMP, CONSTRAINT "PK_340ab539f309f03bdaa14aa7649" PRIMARY KEY ("id"))`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "outbox"`);
		await queryRunner.query(`DROP TYPE "public"."outbox_status_enum"`);
	}
}
