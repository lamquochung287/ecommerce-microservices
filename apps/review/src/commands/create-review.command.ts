import { CreateReviewDto } from '../dto/review.dto';

export class CreateReviewCommand {
	constructor(public readonly dto: CreateReviewDto) {}
}
