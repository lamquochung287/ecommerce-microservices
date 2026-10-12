import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ApproveRefundCommand } from '../approve-refund.command';
import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '../../entities/order.entity';
import { Refund, RefundStatus } from '../../entities/refund.entity';
import { RpcException } from '@nestjs/microservices';
import { canTransition } from '../../order-status.constant';

@CommandHandler(ApproveRefundCommand)
export class ApproveRefundHandler implements ICommandHandler<ApproveRefundCommand> {
	constructor(private readonly dataSource: DataSource) {}

	async execute(command: ApproveRefundCommand) {
		const { id } = command;

		return this.dataSource.transaction(async (manager) => {
			const refund = await manager.findOne(Refund, {
				where: { id },
				relations: ['order', 'order.refunds'],
			});
			if (!refund) {
				throw new RpcException({
					statusCode: 404,
					message: 'Refund not found',
				});
			}
			if (refund.status !== RefundStatus.PENDING) {
				throw new RpcException({
					statusCode: 400,
					message: `Refund đang ở trạng thái ${refund.status}, không thể approve`,
				});
			}

			refund.status = RefundStatus.COMPLETED;
			await manager.save(refund);

			const order = refund.order;
			const totalRefunded = (order.refunds ?? [])
				.filter(
					(r) => r.id === refund.id || r.status === RefundStatus.COMPLETED,
				)
				.reduce(
					(sum, r) =>
						sum + Number(r.id === refund.id ? refund.amount : r.amount),
					0,
				);

			// Full refund -> chuyển Order sang REFUNDED nếu transition hợp lệ từ state hiện tại (DELIVERED -> REFUNDED).
			if (
				totalRefunded >= Number(order.totalAmount) &&
				canTransition(order.status, OrderStatus.REFUNDED)
			) {
				await manager.update(Order, order.id, { status: OrderStatus.REFUNDED });
			}

			return refund;
		});
	}
}
