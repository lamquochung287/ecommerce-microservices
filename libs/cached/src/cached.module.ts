import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CachedService } from './cached.service';
import { REDIS_CLIENT } from './cached.constant';

@Global()
@Module({
	imports: [ConfigModule],
	providers: [
		{
			provide: REDIS_CLIENT,
			useFactory: (configService: ConfigService) => {
				return new Redis({
					host: configService.get<string>('REDIS_HOST') || 'localhost',
					port: configService.get<number>('REDIS_PORT') || 6379,
					password: configService.get<string>('REDIS_PASSWORD'),
					retryStrategy: (times) => {
						if (times > 10) {
							console.error('ERROR:::RETRY REDIS TIMEOUT');
							return null; // stop retry
						}
						return Math.min(times * 50, 2000);
					},
				});
			},
			inject: [ConfigService],
		},
		CachedService,
	],
	exports: [CachedService, REDIS_CLIENT],
})
export class CachedModule {}
