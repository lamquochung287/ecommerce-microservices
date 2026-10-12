import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RejectRefundCommand } from '../reject-refund.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Refund, RefundStatus } from '../../entities/refund.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(RejectRefundCommand)
export class RejectRefundHandler implements ICommandHandler<RejectRefundCommand> {
	constructor(
		@InjectRepository(Refund)
		private readonly refundRepository: Repository<Refund>,
	) {}

	async execute(command: RejectRefundCommand) {
		const { id } = command;

		const refund = await this.refundRepository.findOne({ where: { id } });
		if (!refund) {
			throw new RpcException({ statusCode: 404, message: 'Refund not found' });
		}
		if (refund.status !== RefundStatus.PENDING) {
			throw new RpcException({
				statusCode: 400,
				message: `Refund đang ở trạng thái ${refund.status}, không thể reject`,
			});
		}

		refund.status = RefundStatus.REJECTED;
		return this.refundRepository.save(refund);
	}
}
