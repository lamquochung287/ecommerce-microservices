import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
	imports: [
		TypeOrmModule.forRootAsync({
			// Nạp ConfigModule để có thể dùng được ConfigService
			imports: [ConfigModule],

			// Inject ConfigService vào hàm khởi tạo
			inject: [ConfigService],

			useFactory: (configService: ConfigService) => ({
				type: 'postgres', // Do bạn đang dùng Postgres trong file docker-compose
				host: configService.get<string>('DB_HOST', 'localhost'),
				port: configService.get<number>('DB_PORT', 5432),
				username: configService.get<string>('DB_USER', 'root'),
				password: configService.get<string>('DB_PASSWORD', 'password'),
				database: configService.get<string>('DB_NAME', 'ecommerce'),

				// Tự động load các Entity mà bạn viết ở các Microservice
				autoLoadEntities: true,

				// Tự động tạo/cập nhật bảng trong DB dựa trên Entity (Chỉ nên set true khi làm dev)
				synchronize: true,

				// Connection pool: mặc định của driver pg quá nhỏ (10) cho tải đồng thời cao
				extra: {
					max: configService.get<number>('DB_POOL_MAX', 50),
					min: configService.get<number>('DB_POOL_MIN', 5),
					idleTimeoutMillis: 30000,
					connectionTimeoutMillis: 5000,
				},
			}),
		}),
	],
})
export class DatabaseModule {}
