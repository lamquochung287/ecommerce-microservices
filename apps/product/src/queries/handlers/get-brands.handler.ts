import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { GetBrandsQuery } from '../get-brands.query';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from '../../entities/brand.entity';

@QueryHandler(GetBrandsQuery)
export class GetBrandsHandler implements IQueryHandler<GetBrandsQuery> {
	constructor(
		@InjectRepository(Brand)
		private readonly brandRepository: Repository<Brand>,
	) {}

	async execute() {
		return this.brandRepository.find({ order: { name: 'ASC' } });
	}
}
