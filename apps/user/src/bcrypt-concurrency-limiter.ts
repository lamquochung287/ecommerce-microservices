import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

/**
 * Giới hạn số tác vụ bcrypt chạy đồng thời. Mỗi bcrypt tốn ~1 lõi CPU trong ~50ms nên một đợt đăng nhập dồn dập
 * làm kín quota CPU và request xếp hàng quá timeout của Gateway, trong khi service vẫn tính bcrypt cho request đã
 * bị bỏ. Ở đây: tối đa `maxConcurrent` tác vụ chạy, tối đa `maxQueue` tác vụ chờ, chờ quá `maxWaitMs` hoặc hàng
 * đợi đầy thì từ chối ngay bằng 429 (lỗi 4xx nên circuit breaker của Gateway không đếm là lỗi hạ tầng).
 */
export class BcryptConcurrencyLimiter {
	private running = 0;
	private readonly queue: Array<{
		start: () => void;
		timer: NodeJS.Timeout;
	}> = [];

	constructor(
		private readonly maxConcurrent: number,
		private readonly maxQueue: number,
		private readonly maxWaitMs: number,
	) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await task();
		} finally {
			this.release();
		}
	}

	private acquire(): Promise<void> {
		if (this.running < this.maxConcurrent) {
			this.running++;
			return Promise.resolve();
		}
		if (this.queue.length >= this.maxQueue) {
			return Promise.reject(this.overloaded());
		}
		return new Promise<void>((resolve, reject) => {
			const entry = {
				start: () => {
					clearTimeout(entry.timer);
					resolve();
				},
				timer: setTimeout(() => {
					const index = this.queue.indexOf(entry);
					if (index >= 0) this.queue.splice(index, 1);
					reject(this.overloaded());
				}, this.maxWaitMs),
			};
			this.queue.push(entry);
		});
	}

	// Chuyển chỗ trực tiếp cho tác vụ chờ lâu nhất (running giữ nguyên) hoặc trả chỗ nếu hàng đợi trống.
	private release() {
		const next = this.queue.shift();
		if (next) next.start();
		else this.running--;
	}

	private overloaded() {
		return new RpcException({
			statusCode: HttpStatus.TOO_MANY_REQUESTS,
			message: 'Hệ thống đang xử lý nhiều đăng nhập, vui lòng thử lại sau ít giây',
		});
	}
}
