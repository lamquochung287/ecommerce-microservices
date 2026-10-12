import { Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import * as CircuitBreaker from 'opossum';

const TIMEOUT_MS = 10000;
const BREAKER_OPTIONS: CircuitBreaker.Options = {
	timeout: false, // timeout đã xử lý bằng RxJS timeout() ở gọi client.send, breaker chỉ đếm success/fail
	errorThresholdPercentage: 50, // mở breaker khi >50% request lỗi trong rolling window
	resetTimeout: 15000, // sau 15s ở trạng thái open, breaker chuyển sang half-open để thử lại
	rollingCountTimeout: 10000,
	rollingCountBuckets: 10,
};

// opossum's TS generic inference không suy ra đúng tuple từ constructor function,
// nên dùng `any` cục bộ ở đây thay vì ép kiểu generic sai lệch.
@Injectable()
export class TcpResilienceService {
	private readonly logger = new Logger(TcpResilienceService.name);
	private readonly breakers = new Map<string, CircuitBreaker<any, unknown>>();

	private getBreaker(serviceKey: string): CircuitBreaker<any, unknown> {
		const existing = this.breakers.get(serviceKey);
		if (existing) {
			return existing;
		}

		const call = (
			client: ClientProxy,
			pattern: Record<string, unknown>,
			data: unknown,
		) => firstValueFrom(client.send(pattern, data).pipe(timeout(TIMEOUT_MS)));
		const breaker: CircuitBreaker<any, unknown> = new CircuitBreaker(
			call,
			BREAKER_OPTIONS,
		);

		breaker.on('open', () =>
			this.logger.warn(
				`Circuit breaker OPEN for ${serviceKey} — service tạm bị coi là unhealthy, request sẽ fail-fast`,
			),
		);
		breaker.on('halfOpen', () =>
			this.logger.log(
				`Circuit breaker HALF-OPEN for ${serviceKey} — thử lại request kế tiếp`,
			),
		);
		breaker.on('close', () =>
			this.logger.log(
				`Circuit breaker CLOSED for ${serviceKey} — service đã healthy trở lại`,
			),
		);

		this.breakers.set(serviceKey, breaker);
		return breaker;
	}

	/**
	 * Gọi TCP microservice qua circuit breaker dùng chung theo serviceKey.
	 * Ném lỗi gốc (timeout/RpcException/breaker-open) để caller tự xử lý qua MicroserviceErrorHandler.
	 */
	async send<T>(
		serviceKey: string,
		client: ClientProxy,
		pattern: Record<string, unknown>,
		data: unknown,
	): Promise<T> {
		const breaker = this.getBreaker(serviceKey);
		return breaker.fire(client, pattern, data) as Promise<T>;
	}
}
