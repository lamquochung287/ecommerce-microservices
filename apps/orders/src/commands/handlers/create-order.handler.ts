import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateOrderCommand } from '../create-order.command';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Inject, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { Outbox } from '../../entities/outbox.entity';
import { ORDER_EVENT_TYPE } from '../../events/order-event-type.constant';
import { InventoryReservationService } from '../../saga/inventory-reservation.service';
import {
	PAYMENT_PROVIDER,
	PaymentProvider,
} from '../../saga/payment-provider.interface';

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
	private readonly logger = new Logger(CreateOrderHandler.name);

	constructor(
		private readonly dataSource: DataSource,
		private readonly configService: ConfigService,
		private readonly inventoryReservation: InventoryReservationService,
		@Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
	) {}

	async execute(command: CreateOrderCommand) {
		const { dto } = command;

		const subtotal = dto.items.reduce(
			(sum, item) => sum + item.quantity * item.unitPrice,
			0,
		);
		const taxRate = Number(this.configService.get('ORDER_TAX_RATE') ?? 0.1);
		const shippingFee = Number(
			this.configService.get('ORDER_SHIPPING_FEE_FLAT') ?? 30000,
		);
		const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
		const totalAmount = subtotal + taxAmount + shippingFee;

		// Step 1: Reserve Inventory (Product service qua TCP). Fail ở đây -> chưa trừ được gì, không cần compensate.
		await this.inventoryReservation.reserve(
			dto.items.map((item) => ({
				productId: item.productId,
				quantity: item.quantity,
			})),
		);

		// Order được tạo PENDING trước khi capture payment để có orderId cho payment provider.
		const order = await this.dataSource.transaction(async (manager) => {
			const orderItems = dto.items.map((itemDto) => {
				const item = new OrderItem();
				item.productId = itemDto.productId;
				item.quantity = itemDto.quantity;
				item.unitPrice = itemDto.unitPrice;
				return item;
			});

			const newOrder = manager.create(Order, {
				userId: dto.userId,
				...dto.shippingAddress,
				status: OrderStatus.PENDING,
				subtotal,
				taxAmount,
				shippingFee,
				totalAmount,
				items: orderItems,
			});
			return manager.save(newOrder);
		});

		// Step 2: Capture Payment qua apps/payment (Phase 2) — order.id dùng làm idempotency key vì
		// đã unique và cố định cho suốt vòng đời order, an toàn để Payment service dedupe khi retry.
		const captureResult = await this.paymentProvider.capture(
			order.id,
			totalAmount,
			order.id,
		);

		if (!captureResult.success) {
			// Compensation: release inventory đã reserve, Order chuyển CANCELLED.
			await this.inventoryReservation.release(
				dto.items.map((item) => ({
					productId: item.productId,
					quantity: item.quantity,
				})),
			);
			await this.dataSource
				.getRepository(Order)
				.update(order.id, { status: OrderStatus.CANCELLED });
			this.logger.warn(
				`Order ${order.id} cancelled: payment capture failed (${captureResult.failureReason})`,
			);
			throw new RpcException({
				statusCode: 402,
				message: `Payment failed: ${captureResult.failureReason ?? 'unknown reason'}`,
			});
		}

		// Step 3: Confirm — chuyển PROCESSING + ghi outbox event cùng transaction.
		return this.dataSource.transaction(async (manager) => {
			await manager.update(Order, order.id, { status: OrderStatus.PROCESSING });

			const outboxEvent = manager.create(Outbox, {
				eventType: ORDER_EVENT_TYPE.ORDER_CREATED,
				payload: {
					orderId: order.id,
					userId: order.userId,
					totalAmount: order.totalAmount,
				},
			});
			await manager.save(outboxEvent);

			return manager.findOne(Order, { where: { id: order.id } });
		});
	}
}
