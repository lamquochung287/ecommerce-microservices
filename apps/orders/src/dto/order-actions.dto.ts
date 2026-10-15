import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export const RETURN_REASON_MAX_LENGTH = 500;

/** orderId và userId đến từ tham số TCP (userId do Gateway lấy từ token), không phải từ body của client. */
export class CancelOrderDto {
	@IsUUID()
	orderId: string;

	@IsUUID()
	userId: string;
}

export class RequestReturnDto extends CancelOrderDto {
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value,
	)
	@IsString()
	@IsNotEmpty()
	@MaxLength(RETURN_REASON_MAX_LENGTH)
	reason: string;
}
