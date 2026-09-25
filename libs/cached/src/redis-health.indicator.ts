import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cached.constant';

@Injectable()
export class RedisHealthIndicator {
	constructor(
		@Inject(REDIS_CLIENT) private readonly redisClient: Redis,
		private readonly healthIndicatorService: HealthIndicatorService,
	) {}

	async pingCheck(key: string) {
		const indicator = this.healthIndicatorService.check(key);
		try {
			await this.redisClient.ping();
			return indicator.up();
		} catch (err) {
			return indicator.down({ message: err.message });
		}
	}
}
