import { UpdateAttributeDto } from '../dto/attribute.dto';

export class UpdateAttributeCommand {
	constructor(
		public readonly id: string,
		public readonly dto: UpdateAttributeDto,
	) {}
}
