import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductCatalogEntities1790332628490 implements MigrationInterface {
    name = 'AddProductCatalogEntities1790332628490'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "brands" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "slug" character varying(255) NOT NULL, "description" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_b15428f362be2200922952dc268" UNIQUE ("slug"), CONSTRAINT "PK_b0c437120b624da1034a81fc561" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "attributes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(255) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_89afb34fd1fdb2ceb1cea6c57df" UNIQUE ("name"), CONSTRAINT "PK_32216e2e61830211d3a5d7fa72c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "attribute_values" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "value" character varying(255) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "attribute_id" uuid, CONSTRAINT "PK_3babf93d1842d73e7ba849c0160" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "product_variants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sku" character varying(100) NOT NULL, "price" numeric(10,2), "stock" integer NOT NULL DEFAULT '0', "version" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "product_id" uuid, CONSTRAINT "UQ_46f236f21640f9da218a063a866" UNIQUE ("sku"), CONSTRAINT "PK_281e3f2c55652d6a22c0aa59fd7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "product_variant_attribute_values" ("variant_id" uuid NOT NULL, "attribute_value_id" uuid NOT NULL, CONSTRAINT "PK_66a61d7b49e259e2c57b52c9e5c" PRIMARY KEY ("variant_id", "attribute_value_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e40919ed207447263838abb8d1" ON "product_variant_attribute_values" ("variant_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e0be09d18c89aced75cc695922" ON "product_variant_attribute_values" ("attribute_value_id") `);
        await queryRunner.query(`ALTER TABLE "products" ADD "lowStockThreshold" integer NOT NULL DEFAULT '10'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "version" integer NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "products" ADD "images" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "brand_id" uuid`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_1530a6f15d3c79d1b70be98f2be" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attribute_values" ADD CONSTRAINT "FK_be02d0f6a15bc7a0d835f832b62" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_variants" ADD CONSTRAINT "FK_6343513e20e2deab45edfce1316" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_variant_attribute_values" ADD CONSTRAINT "FK_e40919ed207447263838abb8d11" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "product_variant_attribute_values" ADD CONSTRAINT "FK_e0be09d18c89aced75cc695922f" FOREIGN KEY ("attribute_value_id") REFERENCES "attribute_values"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_variant_attribute_values" DROP CONSTRAINT "FK_e0be09d18c89aced75cc695922f"`);
        await queryRunner.query(`ALTER TABLE "product_variant_attribute_values" DROP CONSTRAINT "FK_e40919ed207447263838abb8d11"`);
        await queryRunner.query(`ALTER TABLE "product_variants" DROP CONSTRAINT "FK_6343513e20e2deab45edfce1316"`);
        await queryRunner.query(`ALTER TABLE "attribute_values" DROP CONSTRAINT "FK_be02d0f6a15bc7a0d835f832b62"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_1530a6f15d3c79d1b70be98f2be"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "brand_id"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "images"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "version"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "lowStockThreshold"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e0be09d18c89aced75cc695922"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e40919ed207447263838abb8d1"`);
        await queryRunner.query(`DROP TABLE "product_variant_attribute_values"`);
        await queryRunner.query(`DROP TABLE "product_variants"`);
        await queryRunner.query(`DROP TABLE "attribute_values"`);
        await queryRunner.query(`DROP TABLE "attributes"`);
        await queryRunner.query(`DROP TABLE "brands"`);
    }

}
