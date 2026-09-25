import { UpdateVariantDto } from '../dto/product-variant.dto';

export class UpdateVariantCommand {
	constructor(
		public readonly id: string,
		public readonly dto: UpdateVariantDto,
	) {}
}
