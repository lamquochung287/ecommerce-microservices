import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteBrandCommand } from '../delete-brand.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from '../../entities/brand.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(DeleteBrandCommand)
export class DeleteBrandHandler implements ICommandHandler<DeleteBrandCommand> {
	constructor(
		@InjectRepository(Brand) private readonly brandRepository: Repository<Brand>,
	) {}

	async execute(command: DeleteBrandCommand) {
		const { id } = command;

		const brand = await this.brandRepository.findOne({ where: { id } });
		if (!brand) {
			throw new RpcException({ statusCode: 404, message: 'Brand not found' });
		}

		await this.brandRepository.remove(brand);
		return { success: true, message: 'Brand deleted successfully' };
	}
}
