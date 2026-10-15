/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
// @lib/media kéo SDK MinIO không cần cho test; @lib/cached/terminus là ESM-only.
jest.mock('@lib/media', () => ({ MediaService: class MediaService {} }));
// Barrel @lib/common chạy ConfigModule.forRoot + validateEnv (đọc .env thật); DTO chỉ cần PaginationQueryDto.
jest.mock('@lib/common', () =>
	jest.requireActual(
		'../../../../libs/common/src/pagination/pagination-query.dto',
	),
);

import { ClientProxy } from '@nestjs/microservices';
import { INVENTORY_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { ProductController } from './product.controller';
import {
	INVENTORY_LOOKUP_TIMEOUT_MS,
	InventoryService,
} from './inventory.service';
import { ProductService } from './product.service';
import { TcpResilienceService } from '../common/tcp-resilience.service';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

describe('ProductController catalog + inventory', () => {
	let tcp: { send: jest.Mock };
	let productService: {
		getProducts: jest.Mock;
		getProduct: jest.Mock;
	};
	let controller: ProductController;

	beforeEach(() => {
		tcp = { send: jest.fn() };
		productService = { getProducts: jest.fn(), getProduct: jest.fn() };
		const inventory = new InventoryService(
			{} as ClientProxy,
			tcp as unknown as TcpResilienceService,
		);
		controller = new ProductController(
			productService as unknown as ProductService,
			inventory,
			{} as never,
		);
	});

	const page = () => ({
		data: [
			{ id: P1, name: 'A' },
			{ id: P2, name: 'B' },
			{ id: P3, name: 'C' },
		],
		meta: { total: 3, page: 1, limit: 20 },
	});

	it('ghép available/stockStatus và gọi Inventory đúng 1 lần cho cả trang', async () => {
		productService.getProducts.mockResolvedValue(page());
		tcp.send.mockResolvedValue([
			{ productId: P1, available: 7 },
			{ productId: P2, available: 0 },
		]);

		const result = (await controller.getProducts({} as never)) as {
			data: Record<string, unknown>[];
			meta: unknown;
		};

		expect(tcp.send).toHaveBeenCalledTimes(1);
		const [serviceKey, , pattern, payload, timeoutMs] = tcp.send.mock.calls[0];
		expect(serviceKey).toBe(NAME_SERVICE_TCP.INVENTORY_SERVICE);
		expect(pattern).toEqual({
			cmd: INVENTORY_MESSAGE_PATTERN.GET_AVAILABILITY,
		});
		expect(payload).toEqual({ productIds: [P1, P2, P3] });
		expect(timeoutMs).toBe(INVENTORY_LOOKUP_TIMEOUT_MS);
		expect(INVENTORY_LOOKUP_TIMEOUT_MS).toBe(1500);

		expect(result.meta).toEqual({ total: 3, page: 1, limit: 20 });
		expect(result.data).toEqual([
			{ id: P1, name: 'A', available: 7, stockStatus: 'IN_STOCK' },
			{ id: P2, name: 'B', available: 0, stockStatus: 'OUT_OF_STOCK' },
			// Inventory không trả id này: không đoán là hết hàng.
			{ id: P3, name: 'C', available: null, stockStatus: 'UNKNOWN' },
		]);
	});

	it('Inventory timeout -> vẫn trả danh sách, mọi item UNKNOWN, không ném lỗi', async () => {
		productService.getProducts.mockResolvedValue(page());
		tcp.send.mockRejectedValue(
			Object.assign(new Error('Timeout has occurred'), {
				name: 'TimeoutError',
			}),
		);

		const result = (await controller.getProducts({} as never)) as {
			data: { available: number | null; stockStatus: string }[];
		};

		expect(tcp.send).toHaveBeenCalledTimes(1);
		expect(result.data).toHaveLength(3);
		for (const item of result.data) {
			expect(item.available).toBeNull();
			expect(item.stockStatus).toBe('UNKNOWN');
		}
	});

	it('breaker mở (lỗi fail-fast) cũng chỉ ra UNKNOWN', async () => {
		productService.getProducts.mockResolvedValue(page());
		tcp.send.mockRejectedValue(new Error('Breaker is open'));
		const result = (await controller.getProducts({} as never)) as {
			data: { stockStatus: string }[];
		};
		expect(result.data.every((item) => item.stockStatus === 'UNKNOWN')).toBe(
			true,
		);
	});

	it('trang rỗng -> không gọi Inventory', async () => {
		productService.getProducts.mockResolvedValue({ data: [], meta: {} });
		const result = (await controller.getProducts({} as never)) as {
			data: unknown[];
		};
		expect(result.data).toEqual([]);
		expect(tcp.send).not.toHaveBeenCalled();
	});

	it('GET :id ghép tồn kho; Inventory lỗi -> UNKNOWN', async () => {
		productService.getProduct.mockResolvedValue({ id: P1, name: 'A' });
		tcp.send.mockResolvedValueOnce([{ productId: P1, available: 3 }]);
		await expect(controller.getProduct(P1)).resolves.toEqual({
			id: P1,
			name: 'A',
			available: 3,
			stockStatus: 'IN_STOCK',
		});

		tcp.send.mockRejectedValueOnce(new Error('down'));
		await expect(controller.getProduct(P1)).resolves.toMatchObject({
			available: null,
			stockStatus: 'UNKNOWN',
		});
	});

	it('GET :id không tìm thấy -> không gọi Inventory', async () => {
		productService.getProduct.mockResolvedValue(null);
		await expect(controller.getProduct(P1)).resolves.toBeNull();
		expect(tcp.send).not.toHaveBeenCalled();
	});

	it('stock-adjustments gọi Inventory ADJUST_STOCK với productId từ path', async () => {
		tcp.send.mockResolvedValue({ onHand: 10 });
		await controller.adjustStock(P1, { delta: 5 } as never);
		const [serviceKey, , pattern, payload] = tcp.send.mock.calls[0];
		expect(serviceKey).toBe(NAME_SERVICE_TCP.INVENTORY_SERVICE);
		expect(pattern).toEqual({ cmd: INVENTORY_MESSAGE_PATTERN.ADJUST_STOCK });
		expect(payload).toEqual({ delta: 5, productId: P1 });
	});
});
