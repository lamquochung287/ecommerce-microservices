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
		this.ttlSeconds = Number(this.configService.get('CART_TTL_SECONDS') ?? DEFAULT_CART_TTL_SECONDS);
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

	async clearCart(userId: string): Promise<void> {
		await this.cachedService.del(this.key(userId));
	}

	private async save(userId: string, cart: Cart): Promise<Cart> {
		cart.updatedAt = new Date().toISOString();
		await this.cachedService.set(this.key(userId), JSON.stringify(cart), this.ttlSeconds);
		return cart;
	}
}
