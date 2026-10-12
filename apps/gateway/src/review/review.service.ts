import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { REVIEW_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { CreateReviewDto } from '../../../review/src/dto/review.dto';

@Injectable()
export class ReviewService {
	constructor(
		@Inject(NAME_SERVICE_TCP.REVIEW_SERVICE)
		private readonly reviewClient: ClientProxy,
		private readonly tcpResilience: TcpResilienceService,
	) {}

	private async send(cmd: string, payload: unknown, action: string) {
		try {
			return await this.tcpResilience.send(
				NAME_SERVICE_TCP.REVIEW_SERVICE,
				this.reviewClient,
				{ cmd },
				payload,
			);
		} catch (error) {
			MicroserviceErrorHandler.handleError(error, action, 'Review service');
		}
	}

	createReview(dto: CreateReviewDto) {
		return this.send(
			REVIEW_MESSAGE_PATTERN.CREATE_REVIEW,
			dto,
			'create review',
		);
	}

	getReviewsByProduct(productId: string) {
		return this.send(
			REVIEW_MESSAGE_PATTERN.GET_REVIEWS_BY_PRODUCT,
			{ productId },
			'get reviews by product',
		);
	}
}
