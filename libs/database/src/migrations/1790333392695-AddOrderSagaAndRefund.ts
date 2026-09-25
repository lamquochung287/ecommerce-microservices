import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrderSagaAndRefund1790333392695 implements MigrationInterface {
    name = 'AddOrderSagaAndRefund1790333392695'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."refunds_status_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')`);
        await queryRunner.query(`CREATE TABLE "refunds" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(10,2) NOT NULL, "reason" text NOT NULL, "status" "public"."refunds_status_enum" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "order_id" uuid, CONSTRAINT "PK_5106efb01eeda7e49a78b869738" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shippingAddress"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "subtotal" numeric(10,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "taxAmount" numeric(10,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "shippingFee" numeric(10,2) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "recipientName" character varying(255) NOT NULL DEFAULT 'N/A'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "recipientPhone" character varying(30) NOT NULL DEFAULT 'N/A'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "addressLine1" character varying(255) NOT NULL DEFAULT 'N/A'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "addressLine2" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "city" character varying(120) NOT NULL DEFAULT 'N/A'`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "province" character varying(120)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "postalCode" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "country" character varying(100) NOT NULL DEFAULT 'N/A'`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "recipientName" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "recipientPhone" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "addressLine1" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "city" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "country" DROP DEFAULT`);
        await queryRunner.query(`ALTER TYPE "public"."orders_status_enum" RENAME TO "orders_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum" AS ENUM('PENDING', 'PROCESSING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum" USING "status"::"text"::"public"."orders_status_enum"`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "refunds" ADD CONSTRAINT "FK_a42db6369017df60549539f5567" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refunds" DROP CONSTRAINT "FK_a42db6369017df60549539f5567"`);
        await queryRunner.query(`CREATE TYPE "public"."orders_status_enum_old" AS ENUM('PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED')`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."orders_status_enum_old" USING "status"::"text"::"public"."orders_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'`);
        await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."orders_status_enum_old" RENAME TO "orders_status_enum"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "country"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "postalCode"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "province"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "city"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "addressLine2"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "addressLine1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "recipientPhone"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "recipientName"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shippingFee"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "taxAmount"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "subtotal"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "shippingAddress" text NOT NULL`);
        await queryRunner.query(`DROP TABLE "refunds"`);
        await queryRunner.query(`DROP TYPE "public"."refunds_status_enum"`);
    }

}
