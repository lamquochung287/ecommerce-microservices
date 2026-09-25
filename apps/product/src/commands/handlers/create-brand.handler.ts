import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateBrandCommand } from '../create-brand.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from '../../entities/brand.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(CreateBrandCommand)
export class CreateBrandHandler implements ICommandHandler<CreateBrandCommand> {
	constructor(
		@InjectRepository(Brand) private readonly brandRepository: Repository<Brand>,
	) {}

	async execute(command: CreateBrandCommand) {
		const { dto } = command;

		const existing = await this.brandRepository.findOne({ where: { slug: dto.slug } });
		if (existing) {
			throw new RpcException({ statusCode: 409, message: 'Brand slug already exists' });
		}

		const brand = this.brandRepository.create(dto);
		return this.brandRepository.save(brand);
	}
}
