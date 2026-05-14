import {
	CallHandler,
	ExecutionContext,
	Injectable,
	NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Response } from 'express';

export interface IResponse<T> {
	statusCode: number;
	message: string;
	data: T;
	status: 'success';
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
	T,
	IResponse<T>
> {
	intercept(
		context: ExecutionContext,
		next: CallHandler,
	): Observable<IResponse<T>> {
		const ctx = context.switchToHttp();
		const response = ctx.getResponse<Response>();
		const status = response.statusCode;
		return next.handle().pipe(
			map((data: T) => ({
				statusCode: status,
				message: 'success',
				data,
				status: 'success',
			})),
		);
	}
}
