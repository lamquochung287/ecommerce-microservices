import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxWriter, OrderCreatedPayload } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { CartService } from '../../cart/cart.service';
import { InventoryClient } from '../../clients/inventory.client';
import { PaymentClient } from '../../clients/payment.client';
import { CheckoutDto } from '../../dto/checkout.dto';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { OrderCancelReason } from '../../order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { OrderVersionConflictError } from '../../order-state/order-version-conflict.error';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import {
	OrderPricingService,
	PricedOrder,
} from '../../pricing/order-pricing.service';
import { CheckoutCommand } from '../checkout.command';

const DEFAULT_PAYMENT_TTL_SECONDS = 900;
const DEFAULT_PUBLIC_API_BASE_URL = 'http://localhost:3000';
// Inventory nhận tối đa 50 đơn bị thay thế trong một lần reserve.
const MAX_REPLACED_ORDERS = 50;

export interface CheckoutResult {
	orderId: string;
	status: OrderStatus.PENDING_PAYMENT;
	payment_url: string;
	expiresAt: string;
}

const badRequest = (message: string) =>
	new RpcException({ statusCode: 400, message });

/**
 * Checkout đồng bộ tới khi có payment_url. Thứ tự là bất biến:
 * validate -> giá server -> reserve kho (kèm thay thế đơn chờ cũ) -> TX tạo đơn + outbox
 * -> chốt #1 (reservation còn hiệu lực) -> tạo payment intent.
 * Cart không bị đụng: chỉ trừ khi thanh toán thành công.
 */
@CommandHandler(CheckoutCommand)
export class CheckoutHandler implements ICommandHandler<CheckoutCommand> {
	private readonly logger = new Logger(CheckoutHandler.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly config: ConfigService,
		private readonly cart: CartService,
		private readonly pricing: OrderPricingService,
		private readonly inventory: InventoryClient,
		private readonly payment: PaymentClient,
		private readonly outboxWriter: OutboxWriter,
		private readonly orderTransition: OrderTransitionService,
		private readonly cancellation: OrderCancellationService,
	) {}

	async execute(command: CheckoutCommand): Promise<CheckoutResult> {
		const { userId } = command;
		const dto = parseCheckoutDto(command.dto);

		const productIds = dto.items.map((item) => item.productId);
		if (new Set(productIds).size !== productIds.length) {
			throw badRequest('Danh sách món bị trùng productId');
		}
		if (dto.items.some((item) => item.variantId !== undefined)) {
			throw badRequest('Chưa hỗ trợ biến thể sản phẩm trong giỏ hàng');
		}

		// Số lượng luôn lấy từ cart (nguồn sự thật), không bao giờ từ client.
		const cart = await this.cart.getCart(userId);
		const cartItems = cart.items ?? [];
		const lines = dto.items.map((selected) => {
			const inCart = cartItems.find((i) => i.productId === selected.productId);
			if (!inCart) {
				throw badRequest(
					`Sản phẩm ${selected.productId} không có trong giỏ hàng`,
				);
			}
			return { productId: inCart.productId, quantity: inCart.quantity };
		});

		// Voucher chưa nối vào checkout: discount cố định 0.
		const priced = await this.pricing.priceItems(lines, 0);

		const orderId = randomUUID();
		const replaces = await this.findReplaceableOrderIds(userId, productIds);

		const ttlSeconds = Number(
			this.config.get('ORDER_PAYMENT_TTL_SECONDS') ??
				DEFAULT_PAYMENT_TTL_SECONDS,
		);
		// Hết hàng: lỗi 409 của Inventory đi thẳng ra ngoài, chưa ghi gì.
		const reservation = await this.inventory.reserve({
			orderId,
			items: lines,
			ttlSeconds,
			replaces,
		});
		const expiresAt = new Date(reservation.expiresAt);

		let order: Order;
		try {
			order = await this.createOrder(
				orderId,
				userId,
				dto,
				priced,
				expiresAt,
				replaces,
			);
		} catch (error) {
			await this.releaseBestEffort(orderId);
			throw error;
		}

		// Chốt #1: chỉ cấp payment_url khi hàng vẫn đang được giữ cho đơn.
		const check = await this.inventory.checkReservation(orderId);
		if (!check.valid) {
			await this.dataSource.transaction((manager) =>
				this.cancellation.cancelUnpaid(
					manager,
					order,
					OrderCancelReason.RESERVATION_INVALID,
					{ releaseInventory: true },
				),
			);
			throw new RpcException({
				statusCode: 409,
				message: 'Hết hàng hoặc hết hạn giữ hàng',
			});
		}

		await this.attachPaymentIntent(order, priced.totalAmount, expiresAt);

		return {
			orderId,
			status: OrderStatus.PENDING_PAYMENT,
			payment_url: this.paymentUrlOf(orderId),
			expiresAt: expiresAt.toISOString(),
		};
	}

	/** Đơn PENDING_PAYMENT của user có ít nhất một productId trùng với lần checkout mới. */
	private async findReplaceableOrderIds(
		userId: string,
		productIds: string[],
	): Promise<string[]> {
		const rows = await this.dataSource.query<{ id: string }[]>(
			`SELECT DISTINCT o."id"
			 FROM "orders" o
			 JOIN "order_items" i ON i."order_id" = o."id"
			 WHERE o."userId" = $1
			   AND o."status" = $2
			   AND o."deletedAt" IS NULL
			   AND i."productId" = ANY($3::uuid[])
			 LIMIT ${MAX_REPLACED_ORDERS}`,
			[userId, OrderStatus.PENDING_PAYMENT, productIds],
		);
		return rows.map((row) => row.id);
	}

	private createOrder(
		orderId: string,
		userId: string,
		dto: CheckoutDto,
		priced: PricedOrder,
		expiresAt: Date,
		replaces: string[],
	): Promise<Order> {
		return this.dataSource.transaction(async (manager) => {
			const created = manager.create(Order, {
				id: orderId,
				userId,
				...dto.shippingAddress,
				status: OrderStatus.PENDING_PAYMENT,
				version: 1,
				expiresAt,
				subtotal: priced.subtotal,
				taxAmount: priced.taxAmount,
				shippingFee: priced.shippingFee,
				discountAmount: priced.discountAmount,
				totalAmount: priced.totalAmount,
				items: priced.items.map((line) => {
					const item = new OrderItem();
					item.productId = line.productId;
					item.quantity = line.quantity;
					item.unitPrice = line.unitPrice;
					return item;
				}),
			});
			const order = await manager.save(created);

			const payload: OrderCreatedPayload = {
				userId,
				totalAmount: priced.totalAmount,
				expiresAt: expiresAt.toISOString(),
			};
			await this.outboxWriter.append(manager, {
				topic: KAFKA_TOPIC.ORDER_EVENTS,
				type: MESSAGE_TYPE.ORDER_CREATED,
				orderId,
				payload,
			});

			for (const oldId of replaces) {
				await this.cancelReplacedOrder(manager, userId, oldId);
			}
			return order;
		});
	}

	/**
	 * Đơn cũ đã bị luồng khác đổi (huỷ, thanh toán, hết hạn) giữa chừng thì bỏ qua: không được làm hỏng
	 * checkout mới. Inventory đã trả phần giữ của đơn cũ trong RESERVE nên không gửi ReleaseInventory.
	 */
	private async cancelReplacedOrder(
		manager: EntityManager,
		userId: string,
		oldId: string,
	): Promise<void> {
		const old = await manager.findOne(Order, {
			where: { id: oldId, userId, status: OrderStatus.PENDING_PAYMENT },
		});
		if (!old) return;
		try {
			await this.cancellation.cancelUnpaid(
				manager,
				old,
				OrderCancelReason.REPLACED,
				{ releaseInventory: false },
			);
		} catch (error) {
			if (error instanceof OrderVersionConflictError) {
				this.logger.warn(
					`Bỏ qua đơn ${oldId}: đã bị đổi trạng thái giữa chừng`,
				);
				return;
			}
			throw error;
		}
	}

	/** Lỗi ở đây không làm hỏng checkout: đơn vẫn chờ thanh toán, bước chốt #2 tạo lại intent. */
	private async attachPaymentIntent(
		order: Order,
		amount: number,
		expiresAt: Date,
	): Promise<void> {
		try {
			const intent = await this.payment.createIntent({
				orderId: order.id,
				amount,
				idempotencyKey: order.id,
				expiresAt: expiresAt.toISOString(),
			});
			await this.dataSource.transaction((manager) =>
				this.orderTransition.updateWithVersion(manager, order, {
					paymentIntentId: intent.intentId,
					paymentCheckoutUrl: intent.checkoutUrl,
				}),
			);
		} catch (error) {
			this.logger.warn(
				`Chưa gắn được payment intent cho đơn ${order.id}: ${errorMessage(error)}`,
			);
		}
	}

	private async releaseBestEffort(orderId: string): Promise<void> {
		try {
			await this.inventory.release(orderId);
		} catch (error) {
			// Reservation vẫn tự hết hạn và job dọn của Inventory sẽ trả kho.
			this.logger.error(
				`Release inventory thất bại cho đơn ${orderId}: ${errorMessage(error)}`,
			);
		}
	}

	private paymentUrlOf(orderId: string): string {
		const base = this.config
			.get<string>('PUBLIC_API_BASE_URL', DEFAULT_PUBLIC_API_BASE_URL)
			.replace(/\/+$/, '');
		return `${base}/orders/${orderId}/pay`;
	}
}

/**
 * Orders không có ValidationPipe: tự kiểm DTO ở biên TCP và loại field lạ
 * (quantity, unitPrice, userId do client gắn thêm) bằng whitelist.
 */
function parseCheckoutDto(raw: unknown): CheckoutDto {
	const dto = plainToInstance(CheckoutDto, raw);
	const errors = validateSync(dto, {
		whitelist: true,
		forbidUnknownValues: true,
	});
	if (errors.length > 0) {
		const message = errors.flatMap((e) => collectConstraints(e)).join('; ');
		throw badRequest(message || 'Dữ liệu checkout không hợp lệ');
	}
	return dto;
}

function collectConstraints(error: {
	constraints?: Record<string, string>;
	children?: unknown[];
}): string[] {
	const own = Object.values(error.constraints ?? {});
	const nested = (error.children ?? []).flatMap((child) =>
		collectConstraints(child as Parameters<typeof collectConstraints>[0]),
	);
	return [...own, ...nested];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : JSON.stringify(error);
}
