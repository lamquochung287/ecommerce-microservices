import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { ProductClient, ProductSnapshot } from '../clients/product.client';
import { round2, toMoney } from './money';

const DEFAULT_TAX_RATE = 0.1;
const DEFAULT_SHIPPING_FEE = 30000;

export interface PricingLine {
	productId: string;
	quantity: number;
}

export interface PricedLine extends PricingLine {
	unitPrice: number;
}

export interface OrderTotals {
	subtotal: number;
	taxAmount: number;
	shippingFee: number;
	discountAmount: number;
	totalAmount: number;
}

export interface PricedOrder extends OrderTotals {
	items: PricedLine[];
}

/**
 * Giá luôn lấy từ Product tại thời điểm checkout; số lượng do caller lấy từ cart.
 * Mọi tiền là number đã làm tròn 2 số (cột decimal về dạng string).
 */
@Injectable()
export class OrderPricingService {
	constructor(
		private readonly products: ProductClient,
		private readonly config: ConfigService,
	) {}

	async priceItems(
		lines: PricingLine[],
		discountAmount = 0,
	): Promise<PricedOrder> {
		const items = await Promise.all(
			lines.map(async (line) => ({
				...line,
				unitPrice: await this.unitPriceOf(line.productId),
			})),
		);
		return { items, ...this.computeTotals(items, discountAmount) };
	}

	computeTotals(items: PricedLine[], discountAmount = 0): OrderTotals {
		const subtotal = round2(
			items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
		);
		const taxRate = Number(
			this.config.get('ORDER_TAX_RATE') ?? DEFAULT_TAX_RATE,
		);
		const shippingFee = toMoney(
			this.config.get('ORDER_SHIPPING_FEE_FLAT') ?? DEFAULT_SHIPPING_FEE,
		);
		const taxAmount = round2(subtotal * taxRate);
		const discount = toMoney(discountAmount);
		return {
			subtotal,
			taxAmount,
			shippingFee,
			discountAmount: discount,
			totalAmount: round2(subtotal + taxAmount + shippingFee - discount),
		};
	}

	private async unitPriceOf(productId: string): Promise<number> {
		let product: ProductSnapshot | undefined;
		try {
			product = await this.products.getProduct(productId);
		} catch (error) {
			// Product trả 404 cho id lạ; với checkout đó là dữ liệu đầu vào sai (400).
			if (
				error instanceof RpcException &&
				(error.getError() as { statusCode?: number })?.statusCode === 404
			) {
				throw invalidProduct(productId);
			}
			throw error;
		}
		const price = Number(product?.price);
		if (!product || !product.isActive || !Number.isFinite(price) || price < 0) {
			throw invalidProduct(productId);
		}
		return toMoney(price);
	}
}

function invalidProduct(productId: string): RpcException {
	return new RpcException({
		statusCode: 400,
		message: `Sản phẩm ${productId} không tồn tại hoặc đã ngừng bán`,
	});
}
