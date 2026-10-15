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

	@MessagePattern({ cmd: HEALTH_MESSAGE_PATTERN.HEALTH_CHECK }, Transport.TCP)
	@HealthCheck()
	check() {
		return this.health.check([() => this.db.pingCheck('database')]);
	}
}
