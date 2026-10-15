import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { ORDER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateReviewCommand } from '../create-review.command';
import { Review } from '../../entities/review.entity';
import { ORDER_TCP_CLIENT } from '../../order-client.constant';

const TCP_TIMEOUT_MS = 10000;
const REVIEWABLE_STATUSES = [
	'PAID',
	'FULFILLING',
	'SHIPPED',
	'DELIVERED',
	'COMPLETED',
];

interface OrderSummary {
	id: string;
	status: string;
	items: { productId: string }[];
}

@CommandHandler(CreateReviewCommand)
export class CreateReviewHandler implements ICommandHandler<CreateReviewCommand> {
	constructor(
		@InjectRepository(Review)
		private readonly reviewRepository: Repository<Review>,
		@Inject(ORDER_TCP_CLIENT) private readonly orderClient: ClientProxy,
	) {}

	async execute(command: CreateReviewCommand) {
		const { userId, productId, orderId, rating, comment } = command.dto;

		const order = await firstValueFrom(
			this.orderClient
				.send<OrderSummary>(
					{ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER },
					{ id: orderId },
				)
				.pipe(timeout(TCP_TIMEOUT_MS)),
		);

		if (!order) {
			throw new RpcException({ statusCode: 404, message: 'Order not found' });
		}

		// Không tin tưởng userId/productId client tự khai — verify order thật sự thuộc user này,
		// đã ở trạng thái đủ để coi là "đã mua" (không cho review khi còn PENDING_PAYMENT/PAID/CANCELLED), và
		// có chứa đúng sản phẩm muốn review.
		const belongsToUser =
			(order as unknown as { userId: string }).userId === userId;
		const isReviewable = REVIEWABLE_STATUSES.includes(order.status);
		const containsProduct = order.items?.some(
			(item) => item.productId === productId,
		);

		if (!belongsToUser || !isReviewable || !containsProduct) {
			throw new RpcException({
				statusCode: 403,
				message: 'Chỉ có thể review sản phẩm đã mua trong đơn hàng hợp lệ',
			});
		}

		const review = this.reviewRepository.create({
			userId,
			productId,
			orderId,
			rating,
			comment: comment ?? null,
		});
		return this.reviewRepository.save(review);
	}
}
