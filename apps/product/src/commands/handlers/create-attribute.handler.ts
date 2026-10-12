import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateAttributeCommand } from '../create-attribute.command';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attribute } from '../../entities/attribute.entity';
import { AttributeValue } from '../../entities/attribute-value.entity';
import { RpcException } from '@nestjs/microservices';

@CommandHandler(CreateAttributeCommand)
export class CreateAttributeHandler implements ICommandHandler<CreateAttributeCommand> {
	constructor(
		@InjectRepository(Attribute)
		private readonly attributeRepository: Repository<Attribute>,
	) {}

	async execute(command: CreateAttributeCommand) {
		const { dto } = command;

		const existing = await this.attributeRepository.findOne({
			where: { name: dto.name },
		});
		if (existing) {
			throw new RpcException({
				statusCode: 409,
				message: 'Attribute already exists',
			});
		}

		const attribute = this.attributeRepository.create({
			name: dto.name,
			values: dto.values.map((value) =>
				Object.assign(new AttributeValue(), { value }),
			),
		});

		return this.attributeRepository.save(attribute);
	}
}
