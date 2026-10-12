import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UpdateAttributeCommand } from '../update-attribute.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attribute } from '../../entities/attribute.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(UpdateAttributeCommand)
export class UpdateAttributeHandler implements ICommandHandler<UpdateAttributeCommand> {
	constructor(
		@InjectRepository(Attribute)
		private readonly attributeRepository: Repository<Attribute>,
	) {}

	async execute(command: UpdateAttributeCommand) {
		const { id, dto } = command;

		const attribute = await this.attributeRepository.findOne({ where: { id } });
		if (!attribute) {
			throw new RpcException({
				statusCode: 404,
				message: 'Attribute not found',
			});
		}

		Object.assign(attribute, dto);
		return this.attributeRepository.save(attribute);
	}
}
