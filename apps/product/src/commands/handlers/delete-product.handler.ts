import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteProductCommand } from '../delete-product.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(DeleteProductCommand)
export class DeleteProductHandler implements ICommandHandler<DeleteProductCommand> {
	constructor(
		@InjectRepository(Product)
		private readonly productRepository: Repository<Product>,
	) {}

	async execute(command: DeleteProductCommand) {
		const { id } = command;

		const product = await this.productRepository.findOne({ where: { id } });
		if (!product) {
			throw new RpcException({ statusCode: 404, message: 'Product not found' });
		}

		await this.productRepository.remove(product);
		return { success: true, message: 'Product deleted successfully' };
	}
}
