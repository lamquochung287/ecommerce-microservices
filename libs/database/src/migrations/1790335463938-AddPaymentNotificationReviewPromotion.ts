import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentNotificationReviewPromotion1790335463938 implements MigrationInterface {
    name = 'AddPaymentNotificationReviewPromotion1790335463938'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "reviews" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "productId" uuid NOT NULL, "orderId" uuid NOT NULL, "rating" integer NOT NULL, "comment" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_1da63d055ec5a70e90f4afb1dfb" UNIQUE ("userId", "productId", "orderId"), CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."vouchers_discounttype_enum" AS ENUM('PERCENTAGE', 'FIXED')`);
        await queryRunner.query(`CREATE TABLE "vouchers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(50) NOT NULL, "discountType" "public"."vouchers_discounttype_enum" NOT NULL, "discountValue" numeric(10,2) NOT NULL, "minOrderValue" numeric(10,2) NOT NULL DEFAULT '0', "expiresAt" TIMESTAMP NOT NULL, "usageLimit" integer NOT NULL, "usageCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_efc30b2b9169e05e0e1e19d6dd6" UNIQUE ("code"), CONSTRAINT "PK_ed1b7dd909a696560763acdbc04" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payment_webhook_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventId" character varying(255) NOT NULL, "orderId" uuid NOT NULL, "processedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_285c1511493d4fd22fa0ccf258d" UNIQUE ("eventId"), CONSTRAINT "PK_b08bdb3156baf74902b89dfb161" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."payment_transactions_status_enum" AS ENUM('SUCCEEDED', 'FAILED')`);
        await queryRunner.query(`CREATE TABLE "payment_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "idempotencyKey" character varying(255) NOT NULL, "amount" numeric(10,2) NOT NULL, "status" "public"."payment_transactions_status_enum" NOT NULL, "failureReason" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_876b0f8f2d5b307f5b736c18148" UNIQUE ("idempotencyKey"), CONSTRAINT "PK_d32b3c6b0d2c1d22604cbcc8c49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."sent_notifications_channel_enum" AS ENUM('EMAIL', 'PUSH')`);
        await queryRunner.query(`CREATE TYPE "public"."sent_notifications_status_enum" AS ENUM('SENT', 'FAILED')`);
        await queryRunner.query(`CREATE TABLE "sent_notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel" "public"."sent_notifications_channel_enum" NOT NULL, "recipient" character varying(255) NOT NULL, "subject" character varying(255) NOT NULL, "body" text NOT NULL, "status" "public"."sent_notifications_status_enum" NOT NULL, "sourceEvent" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d51e53c462c7e75c4d96dbdf792" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "sent_notifications"`);
        await queryRunner.query(`DROP TYPE "public"."sent_notifications_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."sent_notifications_channel_enum"`);
        await queryRunner.query(`DROP TABLE "payment_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."payment_transactions_status_enum"`);
        await queryRunner.query(`DROP TABLE "payment_webhook_logs"`);
        await queryRunner.query(`DROP TABLE "vouchers"`);
        await queryRunner.query(`DROP TYPE "public"."vouchers_discounttype_enum"`);
        await queryRunner.query(`DROP TABLE "reviews"`);
    }

}
