import { RpcException } from '@nestjs/microservices';
import { NEVER, of, throwError } from 'rxjs';
import { sendTcp, toRpcException } from './rpc-error.util';

describe('toRpcException', () => {
	it('bọc object {statusCode,message} thành RpcException, giữ field phụ', () => {
		const result = toRpcException({
			statusCode: 409,
			message: 'Hết hàng',
			productIds: ['p-1'],
		});
		expect(result).toBeInstanceOf(RpcException);
		expect((result as RpcException).getError()).toEqual({
			statusCode: 409,
			message: 'Hết hàng',
			productIds: ['p-1'],
		});
	});

	it('giữ nguyên RpcException và lỗi không có statusCode', () => {
		const rpc = new RpcException({ statusCode: 400, message: 'x' });
		expect(toRpcException(rpc)).toBe(rpc);
		const plain = new Error('boom');
		expect(toRpcException(plain)).toBe(plain);
		expect(toRpcException(null)).toBeNull();
	});
});

describe('sendTcp', () => {
	it('trả giá trị response', async () => {
		const client = { send: jest.fn().mockReturnValue(of({ ok: true })) };
		await expect(
			sendTcp(client as never, 'pattern', { a: 1 }, 1000),
		).resolves.toEqual({ ok: true });
		expect(client.send).toHaveBeenCalledWith({ cmd: 'pattern' }, { a: 1 });
	});

	it('lỗi nghiệp vụ về thành RpcException', async () => {
		const client = {
			send: jest
				.fn()
				.mockReturnValue(
					throwError(() => ({ statusCode: 404, message: 'not found' })),
				),
		};
		await expect(
			sendTcp(client as never, 'p', {}, 1000),
		).rejects.toBeInstanceOf(RpcException);
	});

	it('timeout ném TimeoutError (không bọc)', async () => {
		jest.useFakeTimers();
		try {
			const client = { send: jest.fn().mockReturnValue(NEVER) };
			const promise = sendTcp(client as never, 'p', {}, 50);
			const assertion = expect(promise).rejects.toMatchObject({
				name: 'TimeoutError',
			});
			await jest.advanceTimersByTimeAsync(60);
			await assertion;
		} finally {
			jest.useRealTimers();
		}
	});
});
