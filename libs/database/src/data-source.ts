import 'dotenv/config';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
	type: 'postgres',
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 5432,
	username: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'password',
	database: process.env.DB_NAME || 'ecommerce',
	entities: [
		__dirname + '/../../../apps/**/src/**/*.entity{.ts,.js}',
		__dirname + '/../../../libs/**/src/**/*.entity{.ts,.js}',
	],
	migrations: [__dirname + '/../../../libs/database/src/migrations/*{.ts,.js}'],
	synchronize: false,
});
