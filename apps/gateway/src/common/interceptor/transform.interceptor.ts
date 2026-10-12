import {
	Injectable,
	NestInterceptor,
	ExecutionContext,
	CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface ResponseEnvelope<T> {
	success: boolean;
	data: T;
	error: string | null;
	message: string;
	meta: {
		statusCode: number;
		timestamp: string;
		path: string;
		method: string;
		requestId: string | null;
		[key: string]: any;
	};
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
	T,
	ResponseEnvelope<T>
> {
	intercept(
		context: ExecutionContext,
		next: CallHandler,
	): Observable<ResponseEnvelope<T>> {
		const ctx = context.switchToHttp();
		const request = ctx.getRequest<Request>();
		const response = ctx.getResponse<Response>();

		return next.handle().pipe(
			map((data) => {
				// Handle pagination data if it has meta inside
				let responseData = data;
				let extraMeta = {};

				if (
					data &&
					typeof data === 'object' &&
					'meta' in data &&
					'data' in data
				) {
					responseData = data.data;
					extraMeta = data.meta;
				}

				return {
					success: true,
					data: responseData !== undefined ? responseData : null,
					error: null,
					message: 'Success',
					meta: {
						...extraMeta,
						statusCode: response.statusCode,
						timestamp: new Date().toISOString(),
						path: request.url,
						method: request.method,
						requestId: (request.headers['x-request-id'] as string) || null,
					},
				};
			}),
		);
	}
}
