import {
	Injectable,
	NestMiddleware,
	RequestMethod,
	UnauthorizedException,
} from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// Route không yêu cầu x-api-key. Trang simulator mở bằng trình duyệt (không gửi được header);
// controller của nó tự trả 404 khi production. path-to-regexp v8: wildcard phải đặt tên.
export const API_KEY_EXEMPT_ROUTES: (string | RouteInfo)[] = [
	'health',
	{ path: 'simulator/*path', method: RequestMethod.ALL },
];

@Injectable()
export class RequestTrackerMiddleware implements NestMiddleware {
	constructor(private readonly configService: ConfigService) {}

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

		// 3. Check header apiKey have or not
		const apiKey = req.headers['x-api-key'] as string;
		const systemApiKey = this.configService.get<string>('API_KEY');
		if (!apiKey || apiKey !== systemApiKey) {
			throw new UnauthorizedException('API key is missing or invalid');
		}

		next();
	}
}
