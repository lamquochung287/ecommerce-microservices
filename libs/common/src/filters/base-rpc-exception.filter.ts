import {
	ArgumentsHost,
	Catch,
	HttpException,
	HttpStatus,
	Logger,
} from '@nestjs/common';
import { BaseRpcExceptionFilter, RpcException } from '@nestjs/microservices';

@Catch()
export abstract class AbstractRpcExceptionFilter extends BaseRpcExceptionFilter {
	protected readonly logger = new Logger(this.constructor.name);

	catch(exception: unknown, host: ArgumentsHost) {
		// if Rpc exception use default handler
		if (exception instanceof RpcException) {
			return super.catch(exception, host);
		}

		// if http exception -> convert it  to RPC exception
		if (exception instanceof HttpException) {
			const status = exception.getStatus();
			const response = exception.getResponse();

			const rpcException = new RpcException({
				statusCode: status,
				message:
					typeof response === 'string'
						? response
						: (response as { message?: string })?.message || exception.message,
				error: this.getErrorName(status),
				timestamp: new Date().toISOString(),
			});
			return super.catch(rpcException, host);
		}

		// handle typeORM err
		if (this.isDatabaseError(exception)) {
			const rpcException = this.handleDatabaseError(exception);
			return super.catch(rpcException, host);
		}

		// handle validation
		if (this.isValidationError(exception)) {
			const error = exception as { message?: string | string[] };
			const message = Array.isArray(error.message)
				? error.message.join(',')
				: error.message || 'Validation error';

			const rpcException = new RpcException({
				statusCode: HttpStatus.BAD_REQUEST,
				message,
				error: 'Bad Request',
				timestamp: new Date().toISOString(),
			});
			return super.catch(rpcException, host);
		}

		// Server error
		const error = exception as { message?: string };
		const rpcException = new RpcException({
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			message: error?.message || 'Internal server error',
			error: 'Internal server error',
			timestamp: new Date().toISOString(),
		});

		this.logger.error('Unhandled exception: ', exception);
		return super.catch(rpcException, host);
	}

	// ---Helpers ---
	private isDatabaseError(exception: unknown): boolean {
		if (typeof exception === 'object' && exception !== null) {
			const error = exception as {
				constructor?: { name?: string };
				message?: unknown;
				code?: string | number;
				driverError?: { code?: string | number };
			};

			// 1. Check for TypeORM's generic QueryFailedError wrapper
			const isQueryFailedError = error.constructor?.name === 'QueryFailedError';

			// 2. Check for database driver error codes (SQLSTATE or similar)
			// These are more reliable than string matching when changing databases
			const dbCode = error.code ?? error.driverError?.code;

			const message = error.message;
			const isMessageArray = Array.isArray(message);
			const isMessageString = typeof message === 'string';

			// 3. Fallback: Search for common DB keywords if message is a string
			const dbKeywords =
				/duplicate key|unique constraint|foreign key|violates|check constraint/i;
			const hasDbMessage = isMessageString && dbKeywords.test(message);

			return (
				isQueryFailedError ||
				dbCode !== undefined ||
				hasDbMessage ||
				isMessageArray
			);
		}
		return false;
	}

	// handle validation
	private isValidationError(exception: unknown): boolean {
		if (typeof exception === 'object' && exception !== null) {
			const error = exception as {
				constructor?: { name?: string };
				message?: unknown;
			};
			return (
				error.constructor?.name === 'ValidationError' ||
				Array.isArray(error.message) ||
				(typeof error.message === 'string' &&
					error.message.includes('should not be empty'))
			);
		}
		return false;
	}

	// handle database error
	private handleDatabaseError(exception: unknown): RpcException {
		const error = exception as {
			message?: string;
			code?: string | number;
			driverError?: { code?: string | number };
		};
		const msg = error.message || '';
		const code = error.code || error.driverError?.code;

		// Duplicate
		if (code === '23505') {
			return new RpcException({
				statusCode: HttpStatus.CONFLICT,
				message: this.getUniqueConstraintMessage(msg),
				error: 'Conflict',
				timestamp: new Date().toISOString(),
			});
		}

		// Not null
		if (code === '23502') {
			return new RpcException({
				statusCode: HttpStatus.BAD_REQUEST,
				message: 'Not null constraint violation',
				error: 'Bad Request',
				timestamp: new Date().toISOString(),
			});
		}

		// foreign key constraint violation
		if (code === '23503' || msg.includes('foreign key')) {
			return new RpcException({
				statusCode: HttpStatus.BAD_REQUEST,
				message: 'Referenced record does not exist',
				error: 'Bad Request',
				timestamp: new Date().toISOString(),
			});
		}

		return new RpcException({
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			message: 'Database operation error',
			error: 'Internal Server Error',
			timestamp: new Date().toISOString(),
		});
	}

	protected abstract getUniqueConstraintMessage(message: string): string;

	// Get error name from status code (Http Status)
	private getErrorName(status: number): string {
		const names: Record<number, string> = {
			[HttpStatus.BAD_REQUEST]: 'Bad Request',
			[HttpStatus.UNAUTHORIZED]: 'Unauthorized',
			[HttpStatus.FORBIDDEN]: 'Forbidden',
			[HttpStatus.NOT_FOUND]: 'Not Found',
			[HttpStatus.CONFLICT]: 'Conflict',
			[HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
		};
		return names[status] || 'Error';
	}
}
