import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsInt,
	IsOptional,
	IsUUID,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';

export const MAX_AVAILABILITY_IDS = 200;

export class ReservationItemDto {
	@IsUUID()
	productId: string;

	@IsOptional()
	@IsUUID()
	variantId?: string | null;

	@IsInt()
	@Min(1)
	@Max(1_000_000)
	quantity: number;
}

export class ReserveStockDto {
	@IsUUID()
	orderId: string;

	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(100)
	@ValidateNested({ each: true })
	@Type(() => ReservationItemDto)
	items: ReservationItemDto[];

	@IsInt()
	@Min(1)
	@Max(86_400)
	ttlSeconds: number;

	/** Đơn chờ thanh toán cũ bị đơn mới thay thế: phần giữ của chúng được trả trong cùng transaction. */
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(50)
	@IsUUID('all', { each: true })
	replaces?: string[];
}

export class OrderIdDto {
	@IsUUID()
	orderId: string;
}

export class AdjustStockDto {
	@IsUUID()
	productId: string;

	@IsOptional()
	@IsUUID()
	variantId?: string | null;

	@IsInt()
	@Min(-1_000_000)
	@Max(1_000_000)
	delta: number;
}

export class GetAvailabilityDto {
	@IsArray()
	@ArrayMaxSize(MAX_AVAILABILITY_IDS)
	@IsUUID('all', { each: true })
	productIds: string[];
}
