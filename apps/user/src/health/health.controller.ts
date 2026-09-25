import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { HealthCheckService, TypeOrmHealthIndicator, HealthCheck } from '@nestjs/terminus';
import { HEALTH_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { RedisHealthIndicator } from '@lib/cached';

@Controller()
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		private readonly db: TypeOrmHealthIndicator,
		private readonly redis: RedisHealthIndicator,
	) {}

	@MessagePattern({ cmd: HEALTH_MESSAGE_PATTERN.HEALTH_CHECK })
	@HealthCheck()
	check() {
		return this.health.check([
			() => this.db.pingCheck('database'),
			() => this.redis.pingCheck('redis'),
		]);
	}
}
