import { BcryptConcurrencyLimiter } from './bcrypt-concurrency-limiter';

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};

describe('BcryptConcurrencyLimiter', () => {
	it('chỉ chạy tối đa maxConcurrent tác vụ cùng lúc, phần còn lại chờ rồi chạy tiếp', async () => {
		const limiter = new BcryptConcurrencyLimiter(2, 10, 1000);
		let running = 0;
		let peak = 0;
		const gates = Array.from({ length: 5 }, deferred);
		const results = gates.map((gate, i) =>
			limiter.run(async () => {
				running++;
				peak = Math.max(peak, running);
				await gate.promise;
				running--;
				return i;
			}),
		);

		await Promise.resolve();
		expect(running).toBe(2);
		gates.forEach((gate) => gate.resolve());
		await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4]);
		expect(peak).toBe(2);
	});

	it('hàng đợi đầy thì từ chối ngay bằng 429', async () => {
		const limiter = new BcryptConcurrencyLimiter(1, 1, 1000);
		const gate = deferred();
		const first = limiter.run(() => gate.promise);
		const queued = limiter.run(async () => 'queued');

		await expect(limiter.run(async () => 'overflow')).rejects.toMatchObject({
			error: { statusCode: 429 },
		});
		gate.resolve();
		await first;
		await expect(queued).resolves.toBe('queued');
	});

	it('chờ quá maxWaitMs thì bị từ chối và không chạy tác vụ', async () => {
		jest.useFakeTimers();
		try {
			const limiter = new BcryptConcurrencyLimiter(1, 5, 100);
			const gate = deferred();
			const first = limiter.run(() => gate.promise);
			const task = jest.fn(async () => 'x');
			const waiting = limiter.run(task);
			const assertion = expect(waiting).rejects.toMatchObject({
				error: { statusCode: 429 },
			});

			await jest.advanceTimersByTimeAsync(150);
			await assertion;
			expect(task).not.toHaveBeenCalled();

			gate.resolve();
			await first;
		} finally {
			jest.useRealTimers();
		}
	});

	it('tác vụ lỗi vẫn trả chỗ cho tác vụ kế tiếp', async () => {
		const limiter = new BcryptConcurrencyLimiter(1, 5, 1000);
		await expect(
			limiter.run(async () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
		await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
	});
});
