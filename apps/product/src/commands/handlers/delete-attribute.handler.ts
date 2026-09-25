import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DeleteAttributeCommand } from '../delete-attribute.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attribute } from '../../entities/attribute.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(DeleteAttributeCommand)
export class DeleteAttributeHandler implements ICommandHandler<DeleteAttributeCommand> {
	constructor(
		@InjectRepository(Attribute) private readonly attributeRepository: Repository<Attribute>,
	) {}

	async execute(command: DeleteAttributeCommand) {
		const { id } = command;

		const attribute = await this.attributeRepository.findOne({ where: { id } });
		if (!attribute) {
			throw new RpcException({ statusCode: 404, message: 'Attribute not found' });
		}

		await this.attributeRepository.remove(attribute);
		return { success: true, message: 'Attribute deleted successfully' };
	}
}
