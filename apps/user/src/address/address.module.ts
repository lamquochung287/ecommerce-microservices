import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { Address } from '../entities/address.entity';
import { User } from '../entities/user.entity';

@Module({
	imports: [TypeOrmModule.forFeature([Address, User])],
	controllers: [AddressController],
	providers: [AddressService],
})
export class AddressModule {}
