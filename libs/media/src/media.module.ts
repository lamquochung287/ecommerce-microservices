import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { MediaService } from './media.service';
import { MINIO_CLIENT, MEDIA_BUCKET } from './media.constant';

@Global()
@Module({
	imports: [ConfigModule],
	providers: [
		{
			provide: MINIO_CLIENT,
			useFactory: (configService: ConfigService) => {
				return new Client({
					endPoint: configService.get<string>('MINIO_ENDPOINT', 'localhost'),
					port: configService.get<number>('MINIO_PORT', 9000),
					useSSL: false,
					accessKey: configService.get<string>(
						'MINIO_ACCESS_KEY',
						'minioadmin',
					),
					secretKey: configService.get<string>(
						'MINIO_SECRET_KEY',
						'minioadmin',
					),
				});
			},
			inject: [ConfigService],
		},
		MediaService,
	],
	exports: [MediaService],
})
export class MediaModule implements OnModuleInit {
	constructor(private readonly mediaService: MediaService) {}

	// Tự tạo bucket nếu chưa tồn tại — tránh phải setup thủ công qua MinIO console khi chạy local lần đầu.
	async onModuleInit() {
		await this.mediaService.ensureBucketExists(MEDIA_BUCKET);
	}
}
