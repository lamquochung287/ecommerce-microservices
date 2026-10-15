import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { CancelOrderDto } from '../../dto/order-actions.dto';
import { parseDto } from '../../dto/parse-dto';
import {
	Order,
	OrderRefundStatus,
	OrderStatus,
} from '../../entities/order.entity';
import { OrderCancelReason } from '../../order-state/order-cancel-reason.enum';
import { OrderCancellationService } from '../../order-state/order-cancellation.service';
import { refundAmountOf } from '../../pricing/money';
import { CancelOrderCommand } from '../cancel-order.command';

export interface CancelOrderResult {
	orderId: string;
	status: OrderStatus;
	cancelReason: string | null;
	refundStatus: OrderRefundStatus;
	/** Số tiền sẽ hoàn (tổng đã thu trừ phí ship); null khi đơn chưa thanh toán. */
	refundAmount: number | null;
}

/**
 * User huỷ đơn khi chưa giao cho vận chuyển. Chỉ chủ đơn mới huỷ được (đơn của người khác trả 404 như
 * không tồn tại). Lệch version = đơn vừa đổi (vd ShipmentCreated thắng): trả 409, không tự retry.
 */
@CommandHandler(CancelOrderCommand)
export class CancelOrderHandler implements ICommandHandler<CancelOrderCommand> {
	constructor(
		private readonly dataSource: DataSource,
		private readonly cancellation: OrderCancellationService,
	) {}

	async execute(command: CancelOrderCommand): Promise<CancelOrderResult> {
		const { orderId, userId } = parseDto(CancelOrderDto, command.payload);

		return this.dataSource.transaction(async (manager) => {
			const order = await manager.findOne(Order, { where: { id: orderId } });
			if (!order || order.userId !== userId) {
				throw new RpcException({ statusCode: 404, message: 'Order not found' });
			}

			switch (order.status) {
				case OrderStatus.PENDING_PAYMENT: {
					const cancelled = await this.cancellation.cancelUnpaid(
						manager,
						order,
						OrderCancelReason.USER,
						{ releaseInventory: true },
					);
					return this.toResult(cancelled, null);
				}
				case OrderStatus.PAID:
				case OrderStatus.FULFILLING: {
					// FULFILLING: vận đơn có thể đã/sắp được tạo; CancelShipment cùng key orderId nên Shipping
					// xử lý sau CreateShipment. PAID: kho có thể chưa commit, RestockInventory cùng key với Commit.
					const cancelled = await this.cancellation.cancelPaid(
						manager,
						order,
						OrderCancelReason.USER,
						{
							restock: true,
							cancelShipment: order.status === OrderStatus.FULFILLING,
						},
					);
					return this.toResult(cancelled, refundAmountOf(order));
				}
				case OrderStatus.SHIPPED:
				case OrderStatus.DELIVERED:
				case OrderStatus.REFUNDING:
					throw new RpcException({
						statusCode: 409,
						message: 'Đơn đã giao cho vận chuyển, không thể huỷ',
					});
				default:
					throw new RpcException({
						statusCode: 400,
						message: `Không thể huỷ đơn đang ở trạng thái ${order.status}`,
					});
			}
		});
	}

	private toResult(
		order: Order,
		refundAmount: number | null,
	): CancelOrderResult {
		return {
			orderId: order.id,
			status: order.status,
			cancelReason: order.cancelReason,
			refundStatus: order.refundStatus,
			refundAmount,
		};
	}
}
