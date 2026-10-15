import { ConfigService } from '@nestjs/config';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { RequestReturnDto } from '../../dto/order-actions.dto';
import { parseDto } from '../../dto/parse-dto';
import { Order, OrderStatus } from '../../entities/order.entity';
import { Refund, RefundStatus } from '../../entities/refund.entity';
import { OrderTransitionService } from '../../order-state/order-transition.service';
import { returnWindowMs } from '../../order-state/return-window';
import { refundAmountOf } from '../../pricing/money';
import { RequestReturnCommand } from '../request-return.command';

export const RETURN_REFUND_REASON = 'RETURN';

export interface RequestReturnResult {
	orderId: string;
	status: OrderStatus;
	refundAmount: number;
}

/**
 * Hoàn hàng: chỉ chủ đơn, chỉ khi DELIVERED và còn trong cửa sổ đổi trả. DELIVERED -> REFUNDING, ghi Refund PENDING
 * và RefundPayment (tổng đã thu trừ phí ship) cùng transaction. Kho chỉ nhập lại sau khi nhận PaymentRefunded.
 */
@CommandHandler(RequestReturnCommand)
export class RequestReturnHandler implements ICommandHandler<RequestReturnCommand> {
	constructor(
		private readonly dataSource: DataSource,
		private readonly orderTransition: OrderTransitionService,
		private readonly config: ConfigService,
	) {}

	async execute(command: RequestReturnCommand): Promise<RequestReturnResult> {
		const { orderId, userId, reason } = parseDto(
			RequestReturnDto,
			command.payload,
		);

		return this.dataSource.transaction(async (manager) => {
			const order = await manager.findOne(Order, { where: { id: orderId } });
			if (!order || order.userId !== userId) {
				throw new RpcException({ statusCode: 404, message: 'Order not found' });
			}
			if (order.status === OrderStatus.COMPLETED) {
				throw new RpcException({
					statusCode: 400,
					message: 'Đơn đã hoàn tất, không thể hoàn hàng',
				});
			}
			if (order.status !== OrderStatus.DELIVERED) {
				throw new RpcException({
					statusCode: 400,
					message: 'Chỉ có thể hoàn hàng khi đơn đã giao',
				});
			}
			if (!order.deliveredAt) {
				throw new RpcException({
					statusCode: 400,
					message:
						'Đơn thiếu thời điểm giao hàng, không thể xác định hạn đổi trả',
				});
			}
			// Cùng ngưỡng với scheduler tự COMPLETED (deliveredAt <= now - window) để không có khoảng hở.
			const deadline =
				new Date(order.deliveredAt).getTime() + returnWindowMs(this.config);
			if (Date.now() >= deadline) {
				throw new RpcException({
					statusCode: 400,
					message: 'Quá thời hạn đổi trả',
				});
			}

			const amount = refundAmountOf(order);
			// Transition trước: lệch version ném 409 khi chưa ghi gì.
			await this.orderTransition.transition(manager, {
				order,
				to: OrderStatus.REFUNDING,
				messages: [
					{
						topic: KAFKA_TOPIC.PAYMENT_COMMANDS,
						type: MESSAGE_TYPE.REFUND_PAYMENT,
						payload: { amount, reason: RETURN_REFUND_REASON },
					},
				],
			});
			await manager.insert(Refund, {
				order: { id: order.id },
				amount,
				reason,
				status: RefundStatus.PENDING,
			});

			return {
				orderId: order.id,
				status: OrderStatus.REFUNDING,
				refundAmount: amount,
			};
		});
	}
}
