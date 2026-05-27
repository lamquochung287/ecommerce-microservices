import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cached.constant';

@Injectable()
export class CachedService implements OnModuleDestroy {
	constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {}

	onModuleDestroy() {
		this.redisClient.disconnect();
	}

	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		if (ttlSeconds) {
			await this.redisClient.set(key, value, 'EX', ttlSeconds);
		} else {
			await this.redisClient.set(key, value);
		}
	}

	async get(key: string): Promise<string | null> {
		return this.redisClient.get(key);
	}

	async del(key: string): Promise<void> {
		await this.redisClient.del(key);
	}
}
