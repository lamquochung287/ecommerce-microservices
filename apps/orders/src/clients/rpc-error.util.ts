import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * Lỗi nghiệp vụ từ service khác về tới đây là object thường `{statusCode, message}`. Phải bọc thành
 * RpcException, nếu không filter mặc định của Nest đổi nó thành "Internal server error" và Gateway
 * mất mã lỗi gốc (vd 409 hết hàng). Timeout/lỗi kết nối giữ nguyên.
 */
export function toRpcException(error: unknown): unknown {
	if (error instanceof RpcException) return error;
	if (
		typeof error === 'object' &&
		error !== null &&
		typeof (error as { statusCode?: unknown }).statusCode === 'number'
	) {
		return new RpcException({ ...(error as Record<string, unknown>) });
	}
	return error;
}

/** Gửi request TCP có timeout và chuẩn hoá lỗi nghiệp vụ. */
export async function sendTcp<T>(
	client: ClientProxy,
	pattern: string,
	payload: unknown,
	timeoutMs: number,
): Promise<T> {
	try {
		return await firstValueFrom(
			client.send<T>({ cmd: pattern }, payload).pipe(timeout(timeoutMs)),
		);
	} catch (error) {
		throw toRpcException(error);
	}
}
