import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRbacAndAddressBook1790334138947 implements MigrationInterface {
	name = 'AddRbacAndAddressBook1790334138947';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`CREATE TABLE "addresses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipientName" character varying(255) NOT NULL, "recipientPhone" character varying(30) NOT NULL, "addressLine1" character varying(255) NOT NULL, "addressLine2" character varying(255), "city" character varying(120) NOT NULL, "province" character varying(120), "postalCode" character varying(20), "country" character varying(100) NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "user_id" integer, CONSTRAINT "PK_745d8f43d3af10ab8247465e450" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "permissions" bigint NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`CREATE TABLE "user_roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "user_id" integer, "role_id" uuid, CONSTRAINT "UQ_23ed6f04fe43066df08379fd034" UNIQUE ("user_id", "role_id"), CONSTRAINT "PK_8acd5cf26ebd158416f477de799" PRIMARY KEY ("id"))`,
		);
		await queryRunner.query(
			`ALTER TABLE "addresses" ADD CONSTRAINT "FK_16aac8a9f6f9c1dd6bcb75ec023" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_87b8888186ca9769c960e926870" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_roles" ADD CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_b23c65e50a758245a33ee35fda1"`,
		);
		await queryRunner.query(
			`ALTER TABLE "user_roles" DROP CONSTRAINT "FK_87b8888186ca9769c960e926870"`,
		);
		await queryRunner.query(
			`ALTER TABLE "addresses" DROP CONSTRAINT "FK_16aac8a9f6f9c1dd6bcb75ec023"`,
		);
		await queryRunner.query(`DROP TABLE "user_roles"`);
		await queryRunner.query(`DROP TABLE "roles"`);
		await queryRunner.query(`DROP TABLE "addresses"`);
	}
}
