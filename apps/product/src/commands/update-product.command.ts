import { UpdateProductDto } from '../dto/product.dto';

export class UpdateProductCommand {
	constructor(
		public readonly id: string,
		public readonly dto: UpdateProductDto,
	) {}
}
