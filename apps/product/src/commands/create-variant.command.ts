import { CreateVariantDto } from '../dto/product-variant.dto';

export class CreateVariantCommand {
	constructor(public readonly dto: CreateVariantDto) {}
}
