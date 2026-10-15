import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CachedService } from '@lib/cached';
import { Cart, CartItemDto } from './cart-item.dto';

const DEFAULT_CART_TTL_SECONDS = 2592000; // 30 ngày

@Injectable()
export class CartService {
	private readonly ttlSeconds: number;

	constructor(
		private readonly cachedService: CachedService,
		private readonly configService: ConfigService,
	) {
		this.ttlSeconds = Number(
			this.configService.get('CART_TTL_SECONDS') ?? DEFAULT_CART_TTL_SECONDS,
		);
	}

	private key(userId: string): string {
		return `cart:${userId}`;
	}

	async getCart(userId: string): Promise<Cart> {
		const raw = await this.cachedService.get(this.key(userId));
		if (!raw) {
			return { userId, items: [], updatedAt: new Date().toISOString() };
		}
		return JSON.parse(raw) as Cart;
	}

	async addItem(userId: string, item: CartItemDto): Promise<Cart> {
		const cart = await this.getCart(userId);
		const existing = cart.items.find((i) => i.productId === item.productId);
		if (existing) {
			existing.quantity += item.quantity;
		} else {
			cart.items.push(item);
		}
		return this.save(userId, cart);
	}

	async updateItem(userId: string, item: CartItemDto): Promise<Cart> {
		const cart = await this.getCart(userId);
		const existing = cart.items.find((i) => i.productId === item.productId);
		if (existing) {
			existing.quantity = item.quantity;
		} else {
			cart.items.push(item);
		}
		return this.save(userId, cart);
	}

	async removeItem(userId: string, productId: string): Promise<Cart> {
		const cart = await this.getCart(userId);
		cart.items = cart.items.filter((i) => i.productId !== productId);
		return this.save(userId, cart);
	}

	/**
	 * Trừ đúng phần đã đặt khỏi giỏ: số lượng còn lại <= 0 thì xoá dòng, phần dư (user thêm khi chờ
	 * thanh toán) và món không thuộc đơn giữ nguyên, món user đã tự xoá bị bỏ qua. Không ghi khi không có gì đổi.
	 */
	async deductItems(
		userId: string,
		items: ReadonlyArray<{ productId: string; quantity: number }>,
	): Promise<Cart> {
		const cart = await this.getCart(userId);
		let changed = false;
		for (const ordered of items) {
			const line = cart.items.find((i) => i.productId === ordered.productId);
			if (!line) continue;
			line.quantity -= ordered.quantity;
			changed = true;
		}
		if (!changed) return cart;
		cart.items = cart.items.filter((i) => i.quantity > 0);
		return this.save(userId, cart);
	}

	async clearCart(userId: string): Promise<void> {
		await this.cachedService.del(this.key(userId));
	}

	private async save(userId: string, cart: Cart): Promise<Cart> {
		cart.updatedAt = new Date().toISOString();
		await this.cachedService.set(
			this.key(userId),
			JSON.stringify(cart),
			this.ttlSeconds,
		);
		return cart;
	}
}
