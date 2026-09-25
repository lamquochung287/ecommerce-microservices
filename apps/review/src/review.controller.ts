import { Controller } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { REVIEW_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { CreateReviewCommand } from './commands/create-review.command';
import { GetReviewsByProductQuery } from './queries/get-reviews-by-product.query';
import { CreateReviewDto } from './dto/review.dto';

@Controller()
export class ReviewController {
	constructor(
		private readonly commandBus: CommandBus,
		private readonly queryBus: QueryBus,
	) {}

	@MessagePattern({ cmd: REVIEW_MESSAGE_PATTERN.CREATE_REVIEW })
	async createReview(@Payload() dto: CreateReviewDto) {
		return this.commandBus.execute(new CreateReviewCommand(dto));
	}

	@MessagePattern({ cmd: REVIEW_MESSAGE_PATTERN.GET_REVIEWS_BY_PRODUCT })
	async getReviewsByProduct(@Payload() data: { productId: string }) {
		return this.queryBus.execute(new GetReviewsByProductQuery(data.productId));
	}
}
