import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetAttributesQuery } from '../get-attributes.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attribute } from '../../entities/attribute.entity';

@QueryHandler(GetAttributesQuery)
export class GetAttributesHandler implements IQueryHandler<GetAttributesQuery> {
	constructor(
		@InjectRepository(Attribute) private readonly attributeRepository: Repository<Attribute>,
	) {}

	async execute() {
		return this.attributeRepository.find({ relations: ['values'], order: { name: 'ASC' } });
	}
}
