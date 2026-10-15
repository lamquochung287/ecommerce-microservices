import { RpcException } from '@nestjs/microservices';

/**
 * UPDATE ... WHERE version = :v không khớp dòng nào: đơn đã bị bên khác đổi. Là RpcException 409 nên
 * request của user nhận thẳng thông báo; consumer/scheduler bắt theo kiểu lớp này để quyết định retry/bỏ qua.
 */
export class OrderVersionConflictError extends RpcException {
	constructor(readonly orderId: string) {
		super({
			statusCode: 409,
			message: 'Đơn vừa thay đổi, hãy tải lại',
		});
	}
}
