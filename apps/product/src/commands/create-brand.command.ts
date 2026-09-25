import { CreateBrandDto } from '../dto/brand.dto';

export class CreateBrandCommand {
	constructor(public readonly dto: CreateBrandDto) {}
}
