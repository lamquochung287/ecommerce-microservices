import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tạo bảng vận đơn của Shipping (mỗi đơn tối đa một vận đơn).
 * Idempotent: DB dựng bằng schema:sync có thể đã có sẵn enum/bảng nên mọi bước đều có guard.
 */
export class AddShipments1791877000000 implements MigrationInterface {
	name = 'AddShipments1791877000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DO $$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipments_status_enum') THEN
					CREATE TYPE "shipments_status_enum" AS ENUM ('CREATED', 'DELIVERED', 'CANCELLED', 'FAILED');
				END IF;
			END $$;
		`);

		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "shipments" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"orderId" uuid NOT NULL,
				"status" "shipments_status_enum" NOT NULL DEFAULT 'CREATED',
				"trackingCode" character varying(100),
				"carrier" character varying(50),
				"failureReason" character varying(500),
				"deliveredAt" TIMESTAMP WITH TIME ZONE,
				"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_shipments_id" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_shipments_orderId" ON "shipments" ("orderId")`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "shipments"`);
		await queryRunner.query(`DROP TYPE IF EXISTS "shipments_status_enum"`);
	}
}
