import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { INVENTORY_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { AdjustStockDto } from '../../../inventory/src/dto/inventory.dto';

export const INVENTORY_LOOKUP_TIMEOUT_MS = 1500;

export type StockStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';

export interface StockInfo {
	available: number | null;
	stockStatus: StockStatus;
}

const UNKNOWN_STOCK: StockInfo = { available: null, stockStatus: 'UNKNOWN' };

@Injectable()
export class InventoryService {
	private readonly logger = new Logger(InventoryService.name);

	constructor(
		@Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
		private readonly inventoryClient: ClientProxy,
		private readonly tcpResilience: TcpResilienceService,
	) {}

	/**
	 * Tồn khả dụng cho một trang sản phẩm bằng đúng một lần gọi Inventory.
	 * Catalog không được hỏng vì kho: lỗi/timeout/breaker mở -> mọi id là UNKNOWN, không ném lỗi.
	 */
	async getStockInfo(productIds: string[]): Promise<Map<string, StockInfo>> {
		const result = new Map<string, StockInfo>();
		const ids = [...new Set(productIds)];
		if (ids.length === 0) return result;

		try {
			const rows = await this.tcpResilience.send<
				{ productId: string; available: number }[]
			>(
				NAME_SERVICE_TCP.INVENTORY_SERVICE,
				this.inventoryClient,
				{ cmd: INVENTORY_MESSAGE_PATTERN.GET_AVAILABILITY },
				{ productIds: ids },
				INVENTORY_LOOKUP_TIMEOUT_MS,
			);
			for (const row of rows ?? []) {
				const available = Number(row.available);
				result.set(row.productId, {
					available,
					stockStatus: available > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
				});
			}
		} catch (error) {
			this.logger.warn(
				`Không lấy được tồn kho, trả UNKNOWN: ${(error as Error)?.message ?? error}`,
			);
			return result; // rỗng -> mọi id rơi về UNKNOWN qua stockInfoOf
		}
		return result;
	}

	static stockInfoOf(
		stock: Map<string, StockInfo>,
		productId: string,
	): StockInfo {
		return stock.get(productId) ?? UNKNOWN_STOCK;
	}

	async adjustStock(dto: AdjustStockDto) {
		try {
			return await this.tcpResilience.send(
				NAME_SERVICE_TCP.INVENTORY_SERVICE,
				this.inventoryClient,
				{ cmd: INVENTORY_MESSAGE_PATTERN.ADJUST_STOCK },
				dto,
			);
		} catch (error) {
			MicroserviceErrorHandler.handleError(
				error,
				'adjust stock',
				'Inventory service',
			);
		}
	}
}
