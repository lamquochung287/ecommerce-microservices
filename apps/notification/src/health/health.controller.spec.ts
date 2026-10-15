import 'reflect-metadata';
import { TRANSPORT_METADATA } from '@nestjs/microservices/constants';
import { Transport } from '@nestjs/microservices';
import { HealthController } from './health.controller';

// Terminus là ESM-only nên không nạp được trong Jest: chỉ cần decorator không làm gì.
jest.mock('@nestjs/terminus', () => ({
	HealthCheck: () => () => undefined,
	HealthCheckService: class {},
	TypeOrmHealthIndicator: class {},
}));

// Service hybrid (TCP + Kafka): handler health chỉ được đăng ký cho TCP.
// Thiếu transport thì Kafka server cũng subscribe pattern dạng JSON làm topic và consumer lỗi.
describe('Notification HealthController', () => {
	it('health check chỉ đăng ký transport TCP', () => {
		expect(
			Reflect.getMetadata(TRANSPORT_METADATA, HealthController.prototype.check),
		).toBe(Transport.TCP);
	});
});
