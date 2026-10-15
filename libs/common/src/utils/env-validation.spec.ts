import 'reflect-metadata';
import { validateEnv } from './env-validation';

const BASE_ENV: Record<string, string> = {
	DB_HOST: 'localhost',
	DB_PORT: '5432',
	DB_USER: 'root',
	DB_PASSWORD: 'password',
	DB_NAME: 'ecommerce',
	REDIS_HOST: 'localhost',
	REDIS_PORT: '6379',
	JWT_ACCESS_SECRET: 'a',
	JWT_ACCESS_EXPIRATION: '15m',
	JWT_REFRESH_SECRET: 'b',
	JWT_REFRESH_EXPIRATION: '7d',
	API_KEY: 'key',
	KAFKA_BROKERS: 'localhost:9092',
	PAYMENT_WEBHOOK_SECRET: 'secret',
	SHIPPING_WEBHOOK_SECRET: 'secret',
};

describe('validateEnv', () => {
	it('cấu hình đầy đủ hợp lệ', () => {
		expect(() => validateEnv(BASE_ENV)).not.toThrow();
	});

	it('thiếu PAYMENT_WEBHOOK_SECRET thì ném lỗi khởi động', () => {
		const { PAYMENT_WEBHOOK_SECRET: _omit, ...env } = BASE_ENV;
		void _omit;
		expect(() => validateEnv(env)).toThrow(/PAYMENT_WEBHOOK_SECRET/);
	});

	it('PAYMENT_SIM_MODE chỉ nhận manual | auto-success | auto-fail', () => {
		expect(() =>
			validateEnv({ ...BASE_ENV, PAYMENT_SIM_MODE: 'auto-success' }),
		).not.toThrow();
		expect(() =>
			validateEnv({ ...BASE_ENV, PAYMENT_SIM_MODE: 'always' }),
		).toThrow(/PAYMENT_SIM_MODE/);
	});
});
