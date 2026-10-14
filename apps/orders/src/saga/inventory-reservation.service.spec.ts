import { ClientProxy, RpcException } from '@nestjs/microservices';
import { throwError, of } from 'rxjs';
import { InventoryReservationService } from './inventory-reservation.service';

function serviceWith(send: jest.Mock) {
	return new InventoryReservationService({ send } as unknown as ClientProxy);
}

const item = { productId: '22222222-2222-2222-2222-222222222222', quantity: 1 };

describe('InventoryReservationService', () => {
	it('đổi lỗi nghiệp vụ của Product (object thường có statusCode) thành RpcException giữ nguyên mã', async () => {
		const send = jest
			.fn()
			.mockReturnValue(
				throwError(() => ({ statusCode: 409, message: 'Không đủ tồn kho' })),
			);

		const error = await serviceWith(send)
			.reserve([item])
			.catch((e) => e);

		expect(error).toBeInstanceOf(RpcException);
		expect(error.getError()).toEqual({
			statusCode: 409,
			message: 'Không đủ tồn kho',
		});
	});

	it('giữ nguyên lỗi không có statusCode (vd timeout)', async () => {
		const timeoutError = new Error('Timeout has occurred');
		const send = jest.fn().mockReturnValue(throwError(() => timeoutError));

		await expect(serviceWith(send).reserve([item])).rejects.toBe(timeoutError);
	});

	it('hoàn kho các item đã trừ khi item sau đó hết hàng, rồi ném lỗi 409 gốc', async () => {
		const send = jest
			.fn()
			.mockReturnValueOnce(of({})) // trừ item 1 thành công
			.mockReturnValueOnce(
				throwError(() => ({ statusCode: 409, message: 'Không đủ tồn kho' })),
			) // item 2 hết hàng
			.mockReturnValueOnce(of({})); // release item 1

		const items = [item, { ...item, productId: 'other-product' }];
		const error = await serviceWith(send)
			.reserve(items)
			.catch((e) => e);

		expect(error).toBeInstanceOf(RpcException);
		expect(error.getError()).toMatchObject({ statusCode: 409 });
		expect(send).toHaveBeenCalledTimes(3);
		expect(send.mock.calls[2][1]).toEqual({
			productId: item.productId,
			delta: item.quantity,
		});
	});
});
