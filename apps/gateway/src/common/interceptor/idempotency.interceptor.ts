import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { CachedService } from '@lib/cached';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private readonly TTL_SECONDS = 24 * 60 * 60; // 24 hours

  constructor(private readonly cachedService: CachedService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();

    // 1. Only enforce idempotency for modifying operations
    const safeMethods = ['GET', 'OPTIONS', 'HEAD', 'TRACE'];
    if (safeMethods.includes(req.method)) {
      return next.handle();
    }

    const idempotencyKey = req['idempotencyKey'];
    if (!idempotencyKey) {
      return next.handle();
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    try {
      // 2. Check if key exists in Redis
      const cached = await this.cachedService.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached);

        if (parsed.status === 'processing') {
          this.logger.warn(`Duplicate request detected. Key: ${idempotencyKey} is still processing.`);
          throw new HttpException(
            'Request is already being processed.',
            HttpStatus.CONFLICT,
          );
        }

        if (parsed.status === 'resolved') {
          this.logger.log(`Returning cached response for key: ${idempotencyKey}`);
          return of(parsed.response);
        }
      }

      // 3. Mark key as processing
      await this.cachedService.set(
        redisKey,
        JSON.stringify({ status: 'processing' }),
        this.TTL_SECONDS,
      );
      this.logger.debug(`Set key ${idempotencyKey} as processing in Redis.`);

    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(`Error in idempotency lookup: ${err.message}`);
      // If Redis fails, fall back to letting request proceed without idempotency safety
      return next.handle();
    }

    // 4. Proceed and tap the result to cache or clean up on failure
    return next.handle().pipe(
      tap(async (response) => {
        try {
          await this.cachedService.set(
            redisKey,
            JSON.stringify({ status: 'resolved', response }),
            this.TTL_SECONDS,
          );
          this.logger.log(`Successfully cached response for key: ${idempotencyKey}`);
        } catch (err) {
          this.logger.error(`Failed to cache resolved response: ${err.message}`);
        }
      }),
      catchError(async (error) => {
        try {
          // If execution fails, delete the key so client can retry
          await this.cachedService.del(redisKey);
          this.logger.warn(`Deleted idempotency key ${idempotencyKey} due to downstream error.`);
        } catch (err) {
          this.logger.error(`Failed to delete idempotency key: ${err.message}`);
        }
        return throwError(() => error);
      })
    );
  }
}
