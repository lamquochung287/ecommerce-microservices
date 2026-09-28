import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import { HealthCheckService, HealthCheck, HealthIndicatorService } from '@nestjs/terminus';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { HEALTH_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { RedisHealthIndicator } from '@lib/cached';

@ApiTags('Health')
@Controller('health')
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		private readonly redis: RedisHealthIndicator,
		private readonly healthIndicatorService: HealthIndicatorService,
		@Inject(NAME_SERVICE_TCP.USER_SERVICE) private readonly userClient: ClientProxy,
		@Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE) private readonly productClient: ClientProxy,
		@Inject(NAME_SERVICE_TCP.ORDER_SERVICE) private readonly orderClient: ClientProxy,
	) {}

	private checkTcpService(name: string, client: ClientProxy) {
		return async () => {
			const indicator = this.healthIndicatorService.check(name);
			try {
				await firstValueFrom(
					client.send({ cmd: HEALTH_MESSAGE_PATTERN.HEALTH_CHECK }, {}).pipe(
						timeout(5000),
						catchError((err) => {
							throw err;
						}),
					),
				);
				return indicator.up();
			} catch (err) {
				return indicator.down({ message: err.message });
			}
		};
	}

	@Get()
	@HealthCheck()
	check() {
		return this.health.check([
			() => this.redis.pingCheck('redis'),
			this.checkTcpService('user-service', this.userClient),
			this.checkTcpService('product-service', this.productClient),
			this.checkTcpService('order-service', this.orderClient),
		]);
	}
}
