/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
import { ClientProxy } from '@nestjs/microservices';
import { NEVER, of, throwError } from 'rxjs';
import { TcpResilienceService } from './tcp-resilience.service';

const clientReturning = (observable: unknown) =>
	({ send: jest.fn().mockReturnValue(observable) }) as unknown as ClientProxy;

describe('TcpResilienceService', () => {
	let service: TcpResilienceService;

	beforeEach(() => {
		service = new TcpResilienceService();
	});

	it('trả kết quả khi service phản hồi', async () => {
		const client = clientReturning(of({ ok: true }));
		const sendSpy = client.send as unknown as jest.Mock;
		await expect(
			service.send('svc-ok', client, { cmd: 'x' }, { a: 1 }),
		).resolves.toEqual({ ok: true });
		expect(sendSpy).toHaveBeenCalledWith({ cmd: 'x' }, { a: 1 });
	});

	it('timeoutMs tuỳ chọn được áp dụng cho lần gọi (ngắn hơn mặc định 10s)', async () => {
		const client = clientReturning(NEVER);
		const startedAt = Date.now();
		await expect(
			service.send('svc-short', client, { cmd: 'x' }, {}, 30),
		).rejects.toMatchObject({ name: 'TimeoutError' });
		expect(Date.now() - startedAt).toBeLessThan(2000);
	});

	it('lỗi 4xx từ service không mở breaker: request hợp lệ sau đó vẫn được gọi', async () => {
		const badRequest = {
			statusCode: 400,
			message: 'Invalid webhook signature',
		};
		const client = clientReturning(throwError(() => badRequest));
		for (let i = 0; i < 5; i++) {
			await expect(
				service.send('svc-4xx', client, { cmd: 'x' }, {}),
			).rejects.toEqual(badRequest);
		}
		const healthy = clientReturning(of({ ok: true }));
		await expect(
			service.send('svc-4xx', healthy, { cmd: 'x' }, {}),
		).resolves.toEqual({ ok: true });
	});

	it('lỗi 5xx từ service vẫn mở breaker và fail-fast', async () => {
		const serverError = { statusCode: 500, message: 'boom' };
		const client = clientReturning(throwError(() => serverError));
		await expect(
			service.send('svc-5xx', client, { cmd: 'x' }, {}),
		).rejects.toEqual(serverError);
		const healthy = clientReturning(of({ ok: true }));
		await expect(
			service.send('svc-5xx', healthy, { cmd: 'x' }, {}),
		).rejects.toMatchObject({ message: expect.stringMatching(/breaker/i) });
	});

	it('mặc định giữ timeout 10s (không timeout sớm khi không truyền)', async () => {
		jest.useFakeTimers();
		try {
			const client = clientReturning(NEVER);
			let settled = false;
			const pending = service
				.send('svc-default', client, { cmd: 'x' }, {})
				.catch((error) => {
					settled = true;
					return error;
				});
			await jest.advanceTimersByTimeAsync(9_000);
			expect(settled).toBe(false);
			await jest.advanceTimersByTimeAsync(1_500);
			await expect(pending).resolves.toMatchObject({ name: 'TimeoutError' });
		} finally {
			jest.useRealTimers();
		}
	});
});
