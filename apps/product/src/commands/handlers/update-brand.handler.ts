import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateBrandCommand } from '../update-brand.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from '../../entities/brand.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(UpdateBrandCommand)
export class UpdateBrandHandler implements ICommandHandler<UpdateBrandCommand> {
	constructor(
		@InjectRepository(Brand)
		private readonly brandRepository: Repository<Brand>,
	) {}

	async execute(command: UpdateBrandCommand) {
		const { id, dto } = command;

		const brand = await this.brandRepository.findOne({ where: { id } });
		if (!brand) {
			throw new RpcException({ statusCode: 404, message: 'Brand not found' });
		}

		Object.assign(brand, dto);
		return this.brandRepository.save(brand);
	}
}
