import {
	Injectable,
	NestInterceptor,
	ExecutionContext,
	CallHandler,
	HttpException,
	HttpStatus,
	Logger,
	BadRequestException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { CachedService } from '@lib/cached';
import { REQUIRE_IDEMPOTENCY_KEY } from '../decorator/require-idempotency-key.decorator';

const SAFE_METHODS = ['GET', 'OPTIONS', 'HEAD', 'TRACE'];
// Key đi vào tên khoá Redis: chỉ cho ký tự an toàn và giới hạn độ dài.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type IdempotentRequest = Request & {
	idempotencyKey?: string;
	user?: { userId?: string };
};

const errorMessage = (err: unknown) =>
	err instanceof Error ? err.message : String(err);

interface CachedResponse {
	status: 'processing' | 'resolved';
	response?: unknown;
	statusCode?: number;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
	private readonly logger = new Logger(IdempotencyInterceptor.name);
	private readonly TTL_SECONDS = 24 * 60 * 60; // 24 hours
	// Marker "đang xử lý" ngắn hơn nhiều để request chết giữa chừng không khoá key cả ngày.
	private readonly PROCESSING_TTL_SECONDS = 120;

	constructor(
		private readonly cachedService: CachedService,
		private readonly reflector: Reflector,
	) {}

	async intercept(
		context: ExecutionContext,
		next: CallHandler,
	): Promise<Observable<any>> {
		const ctx = context.switchToHttp();
		const req = ctx.getRequest<IdempotentRequest>();
		const res = ctx.getResponse<Response>();

		// 1. Only enforce idempotency for modifying operations
		if (SAFE_METHODS.includes(req.method)) {
			return next.handle();
		}

		const required =
			this.reflector.getAllAndOverride<boolean>(REQUIRE_IDEMPOTENCY_KEY, [
				context.getHandler(),
				context.getClass(),
			]) === true;

		const idempotencyKey = req.idempotencyKey;
		if (!idempotencyKey) {
			if (required) {
				throw new BadRequestException('Thiếu header x-idempotency-key');
			}
			return next.handle();
		}
		if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
			throw new BadRequestException(
				'x-idempotency-key không hợp lệ (tối đa 128 ký tự gồm chữ, số, . _ : -)',
			);
		}

		// Scope theo user + method + đường dẫn thực: cùng key của hai user hoặc hai route không đụng nhau.
		const userId = req.user?.userId ?? 'anon';
		const redisKey = `idempotency:${userId}:${req.method}:${req.path}:${idempotencyKey}`;

		try {
			// 2. Check if key exists in Redis
			const cached = await this.cachedService.get(redisKey);
			if (cached) {
				const parsed = JSON.parse(cached) as CachedResponse;

				if (parsed.status === 'processing') {
					this.logger.warn(
						`Duplicate request detected. Key: ${idempotencyKey} is still processing.`,
					);
					throw new HttpException(
						'Request is already being processed.',
						HttpStatus.CONFLICT,
					);
				}

				if (parsed.status === 'resolved') {
					this.logger.log(
						`Returning cached response for key: ${idempotencyKey}`,
					);
					// Replay giữ nguyên status gốc (vd 201) để client không phân biệt được lần đầu hay lần lặp.
					res.status(parsed.statusCode ?? HttpStatus.OK);
					return of(parsed.response);
				}
			}

			// 3. Mark key as processing
			await this.cachedService.set(
				redisKey,
				JSON.stringify({ status: 'processing' } satisfies CachedResponse),
				this.PROCESSING_TTL_SECONDS,
			);
		} catch (err) {
			if (err instanceof HttpException) {
				throw err;
			}
			this.logger.error(`Error in idempotency lookup: ${errorMessage(err)}`);
			if (required) {
				// Không có kho idempotency thì không được chạy route ghi bắt buộc (tránh tạo đơn trùng).
				throw new ServiceUnavailableException(
					'Không kiểm tra được idempotency, vui lòng thử lại',
				);
			}
			// Route thường: Redis lỗi thì chạy tiếp, chấp nhận mất bảo đảm chống trùng.
			return next.handle();
		}

		// 4. Proceed and tap the result to cache or clean up on failure
		return (next.handle() as Observable<unknown>).pipe(
			// Lưu xong mới trả response để lần lặp ngay sau đó thấy 'resolved' thay vì 'processing'.
			mergeMap(async (response: unknown) => {
				try {
					await this.cachedService.set(
						redisKey,
						JSON.stringify({
							status: 'resolved',
							response,
							statusCode: res.statusCode,
						} satisfies CachedResponse),
						this.TTL_SECONDS,
					);
					this.logger.log(
						`Successfully cached response for key: ${idempotencyKey}`,
					);
				} catch (err) {
					this.logger.error(
						`Failed to cache resolved response: ${errorMessage(err)}`,
					);
				}
				return response;
			}),
			// Phải trả về Observable (không dùng async): Promise<Observable> sẽ bị phát ra như một giá trị
			// và nuốt mất lỗi gốc.
			catchError((error: unknown) =>
				from(this.releaseKey(redisKey, idempotencyKey)).pipe(
					mergeMap(() => throwError(() => error)),
				),
			),
		);
	}

	/** Xoá key khi handler lỗi để client được thử lại; lỗi Redis chỉ log, không che lỗi gốc. */
	private async releaseKey(redisKey: string, idempotencyKey: string) {
		try {
			await this.cachedService.del(redisKey);
			this.logger.warn(
				`Deleted idempotency key ${idempotencyKey} due to downstream error.`,
			);
		} catch (err) {
			this.logger.error(
				`Failed to delete idempotency key: ${errorMessage(err)}`,
			);
		}
	}
}
