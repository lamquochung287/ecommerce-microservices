import { CreateAttributeDto } from '../dto/attribute.dto';

export class CreateAttributeCommand {
	constructor(public readonly dto: CreateAttributeDto) {}
}
