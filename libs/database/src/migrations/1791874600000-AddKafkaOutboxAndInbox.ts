import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mở rộng bảng outbox cho relay Kafka (seq/eventId/source/topic/key/backoff) và thêm inbox processed_messages.
 * Idempotent vì DB dựng bằng schema:sync có thể đã có sẵn các cột này.
 * Default của topic/source giữ để code ghi outbox kiểu cũ (chỉ eventType + payload) vẫn insert được.
 */
export class AddKafkaOutboxAndInbox1791874600000 implements MigrationInterface {
	name = 'AddKafkaOutboxAndInbox1791874600000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "seq" BIGSERIAL`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "eventId" uuid NOT NULL DEFAULT uuid_generate_v4()`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "source" character varying(50) NOT NULL DEFAULT 'orders'`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "topic" character varying(100) NOT NULL DEFAULT 'order-events'`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "key" character varying(100)`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP NOT NULL DEFAULT now()`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" ADD COLUMN IF NOT EXISTS "lastError" text`,
		);

		// Backfill row cũ: key theo orderId; row chưa gửi đổi sang tên message type mới.
		await queryRunner.query(
			`UPDATE "outbox" SET "key" = "payload"->>'orderId' WHERE "key" IS NULL`,
		);
		await queryRunner.query(
			`UPDATE "outbox" SET "eventType" = 'OrderCreated' WHERE "status" = 'PENDING' AND "eventType" = 'order.created'`,
		);
		await queryRunner.query(
			`UPDATE "outbox" SET "eventType" = 'OrderStatusChanged' WHERE "status" = 'PENDING' AND "eventType" = 'order.status_updated'`,
		);

		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_outbox_eventId" ON "outbox" ("eventId")`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_outbox_relay" ON "outbox" ("status", "source", "seq")`,
		);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "IDX_outbox_key_status" ON "outbox" ("key", "status")`,
		);

		await queryRunner.query(
			`CREATE TABLE IF NOT EXISTS "processed_messages" (
				"consumer" character varying(100) NOT NULL,
				"eventId" uuid NOT NULL,
				"processedAt" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_processed_messages" PRIMARY KEY ("consumer", "eventId")
			)`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "processed_messages"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_key_status"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_relay"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "UQ_outbox_eventId"`);
		await queryRunner.query(
			`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "lastError"`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "nextAttemptAt"`,
		);
		await queryRunner.query(`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "key"`);
		await queryRunner.query(
			`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "topic"`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "source"`,
		);
		await queryRunner.query(
			`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "eventId"`,
		);
		await queryRunner.query(`ALTER TABLE "outbox" DROP COLUMN IF EXISTS "seq"`);
	}
}
