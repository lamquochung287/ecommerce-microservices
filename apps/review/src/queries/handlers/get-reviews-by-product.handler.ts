import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GetReviewsByProductQuery } from '../get-reviews-by-product.query';
import { Review } from '../../entities/review.entity';

@QueryHandler(GetReviewsByProductQuery)
export class GetReviewsByProductHandler implements IQueryHandler<GetReviewsByProductQuery> {
	constructor(
		@InjectRepository(Review) private readonly reviewRepository: Repository<Review>,
	) {}

	async execute(query: GetReviewsByProductQuery) {
		return this.reviewRepository.find({
			where: { productId: query.productId },
			order: { createdAt: 'DESC' },
		});
	}
}
