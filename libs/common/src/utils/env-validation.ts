import { plainToInstance } from 'class-transformer';
import {
	IsIn,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min,
	validateSync,
} from 'class-validator';

export class EnvironmentVariables {
	@IsOptional()
	@IsNumber()
	PORT?: number;

	@IsNotEmpty()
	@IsString()
	DB_HOST: string;

	@IsNotEmpty()
	@IsNumber()
	DB_PORT: number;

	@IsNotEmpty()
	@IsString()
	DB_USER: string;

	@IsNotEmpty()
	@IsString()
	DB_PASSWORD: string;

	@IsNotEmpty()
	@IsString()
	DB_NAME: string;

	@IsNotEmpty()
	@IsString()
	REDIS_HOST: string;

	@IsNotEmpty()
	@IsNumber()
	REDIS_PORT: number;

	@IsOptional()
	@IsString()
	REDIS_PASSWORD?: string;

	@IsNotEmpty()
	@IsString()
	JWT_ACCESS_SECRET: string;

	@IsNotEmpty()
	@IsString()
	JWT_ACCESS_EXPIRATION: string;

	@IsNotEmpty()
	@IsString()
	JWT_REFRESH_SECRET: string;

	@IsNotEmpty()
	@IsString()
	JWT_REFRESH_EXPIRATION: string;

	@IsNotEmpty()
	@IsString()
	API_KEY: string;

	// Danh sách broker dạng host:port[,host:port]
	@IsNotEmpty()
	@IsString()
	KAFKA_BROKERS: string;

	@IsOptional()
	@IsNumber()
	KAFKA_TOPIC_PARTITIONS?: number;

	@IsOptional()
	@IsNumber()
	KAFKA_CONSUMER_MAX_ATTEMPTS?: number;

	@IsOptional()
	@IsNumber()
	KAFKA_CONSUMER_RETRY_BACKOFF_MS?: number;

	@IsOptional()
	@IsNumber()
	OUTBOX_RELAY_INTERVAL_MS?: number;

	@IsOptional()
	@IsNumber()
	OUTBOX_MAX_RETRY?: number;

	// Reservation quá expiresAt thêm ngần này giây mới bị job dọn (mặc định 60)
	@IsOptional()
	@IsNumber()
	INVENTORY_EXPIRY_GRACE_SECONDS?: number;

	// Khoá HMAC của webhook thanh toán; bắt buộc, không có giá trị mặc định.
	@IsNotEmpty()
	@IsString()
	PAYMENT_WEBHOOK_SECRET: string;

	// manual: bấm nút trên trang simulator; auto-*: tự gọi webhook sau PAYMENT_SIM_DELAY_MS
	@IsOptional()
	@IsIn(['manual', 'auto-success', 'auto-fail'])
	PAYMENT_SIM_MODE?: string;

	@IsOptional()
	@IsNumber()
	PAYMENT_SIM_DELAY_MS?: number;

	@IsOptional()
	@IsString()
	PUBLIC_API_BASE_URL?: string;

	// Thời gian giữ hàng + hạn thanh toán của đơn chờ thanh toán (mặc định 900 = 15 phút)
	@IsOptional()
	@IsNumber()
	ORDER_PAYMENT_TTL_SECONDS?: number;

	// Cửa sổ đổi trả tính từ deliveredAt (mặc định 7 ngày); quá hạn thì scheduler tự COMPLETED
	@IsOptional()
	@IsNumber()
	@Min(1)
	ORDER_RETURN_WINDOW_DAYS?: number;

	// Khoá HMAC của webhook giao hàng; bắt buộc, không có giá trị mặc định.
	@IsNotEmpty()
	@IsString()
	SHIPPING_WEBHOOK_SECRET: string;

	// fail: carrier mô phỏng luôn lỗi (để kiểm thử retry -> DLQ)
	@IsOptional()
	@IsIn(['success', 'fail'])
	SHIPPING_SIM_MODE?: string;

	// >0: tự giao hàng sau ngần này ms kể từ khi tạo vận đơn; 0: chỉ kích hoạt tay
	@IsOptional()
	@IsNumber()
	SHIPPING_SIM_DELIVER_DELAY_MS?: number;

	// 'production' tắt simulator thanh toán và giao hàng
	@IsOptional()
	@IsString()
	NODE_ENV?: string;
}

export function validateEnv(config: Record<string, any>) {
	const validatedConfig = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
	});
	const errors = validateSync(validatedConfig, {
		skipMissingProperties: false,
	});

	if (errors.length > 0) {
		const errorMsg = errors
			.map((e) => `  - ${Object.values(e.constraints || {}).join(', ')}`)
			.join('\n');
		throw new Error(
			`\n❌ [ENVIRONMENT CONFIGURATION VALIDATION FAILED]:\n${errorMsg}\n\nPlease check your .env file.`,
		);
	}
	return validatedConfig;
}
