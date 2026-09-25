import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteVariantCommand } from '../delete-variant.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductVariant } from '../../entities/product-variant.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(DeleteVariantCommand)
export class DeleteVariantHandler implements ICommandHandler<DeleteVariantCommand> {
	constructor(
		@InjectRepository(ProductVariant) private readonly variantRepository: Repository<ProductVariant>,
	) {}

	async execute(command: DeleteVariantCommand) {
		const { id } = command;

		const variant = await this.variantRepository.findOne({ where: { id } });
		if (!variant) {
			throw new RpcException({ statusCode: 404, message: 'Variant not found' });
		}

		await this.variantRepository.softRemove(variant);
		return { success: true, message: 'Variant deleted successfully' };
	}
}
