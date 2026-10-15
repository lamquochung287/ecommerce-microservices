import { Controller } from '@nestjs/common';
import { MessagePattern, Transport } from '@nestjs/microservices';
import {
	HealthCheckService,
	TypeOrmHealthIndicator,
	HealthCheck,
} from '@nestjs/terminus';
import { HEALTH_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';

@Controller()
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		private readonly db: TypeOrmHealthIndicator,
	) {}

	// Chỉ TCP: không có transport thì Kafka server cũng đăng ký pattern này làm topic (JSON không hợp lệ) và consumer lỗi.
	@MessagePattern({ cmd: HEALTH_MESSAGE_PATTERN.HEALTH_CHECK }, Transport.TCP)
	@HealthCheck()
	check() {
		return this.health.check([() => this.db.pingCheck('database')]);
	}
}
