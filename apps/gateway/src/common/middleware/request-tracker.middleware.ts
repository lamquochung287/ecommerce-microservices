import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class RequestTrackerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 1. Correlation ID tracking (x-request-id)
    let requestId = req.headers['x-request-id'] as string;
    if (!requestId) {
      requestId = crypto.randomUUID();
    }
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);

    // 2. Idempotency Key tracking (x-idempotency-key)
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    if (idempotencyKey) {
      req['idempotencyKey'] = idempotencyKey;
      res.setHeader('x-idempotency-key', idempotencyKey);
    }

    next();
  }
}
