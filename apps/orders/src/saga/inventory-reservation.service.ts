import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { PRODUCT_TCP_CLIENT } from './product-client.constant';

const TCP_TIMEOUT_MS = 10000;

export interface ReservationItem {
	productId: string;
	quantity: number;
}

// Gọi trực tiếp Product service qua TCP (không qua Gateway) để reserve/release kho trong Saga.
@Injectable()
export class InventoryReservationService {
	private readonly logger = new Logger(InventoryReservationService.name);

	constructor(
		@Inject(PRODUCT_TCP_CLIENT) private readonly productClient: ClientProxy,
	) {}

	// Trừ kho cho từng item. Nếu 1 item fail giữa chừng, release các item đã trừ thành công trước đó rồi throw lại lỗi gốc.
	async reserve(items: ReservationItem[]): Promise<void> {
		const reserved: ReservationItem[] = [];
		try {
			for (const item of items) {
				await this.adjustStock(item.productId, -item.quantity);
				reserved.push(item);
			}
		} catch (error) {
			if (reserved.length > 0) {
				await this.release(reserved);
			}
			throw error;
		}
	}

	// Compensation: hoàn kho cho các item đã reserve. Best-effort — log lỗi thay vì throw để không che lấp lỗi gốc của saga.
	async release(items: ReservationItem[]): Promise<void> {
		for (const item of items) {
			try {
				await this.adjustStock(item.productId, item.quantity);
			} catch (error) {
				this.logger.error(
					`Compensation FAILED to release stock for productId=${item.productId} qty=${item.quantity}: ${error?.message ?? error}`,
				);
			}
		}
	}

	private adjustStock(productId: string, delta: number) {
		return firstValueFrom(
			this.productClient
				.send(
					{ cmd: PRODUCT_MESSAGE_PATTERN.ADJUST_STOCK },
					{ productId, delta },
				)
				.pipe(timeout(TCP_TIMEOUT_MS)),
		);
	}
}
