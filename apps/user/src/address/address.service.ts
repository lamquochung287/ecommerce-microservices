import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Address } from '../entities/address.entity';
import { User } from '../entities/user.entity';
import { CreateAddressDto, UpdateAddressDto } from './address.dto';

@Injectable()
export class AddressService {
	constructor(
		@InjectRepository(Address) private readonly addressRepository: Repository<Address>,
		@InjectRepository(User) private readonly userRepository: Repository<User>,
		@InjectDataSource() private readonly dataSource: DataSource,
	) {}

	async createAddress(dto: CreateAddressDto): Promise<Address> {
		const user = await this.userRepository.findOne({ where: { userId: dto.userId } });
		if (!user) {
			throw new NotFoundException('User not found');
		}

		return this.dataSource.transaction(async (manager) => {
			if (dto.isDefault) {
				await manager.update(Address, { user: { id: user.id } }, { isDefault: false });
			}

			const address = manager.create(Address, {
				user,
				recipientName: dto.recipientName,
				recipientPhone: dto.recipientPhone,
				addressLine1: dto.addressLine1,
				addressLine2: dto.addressLine2 ?? null,
				city: dto.city,
				province: dto.province ?? null,
				postalCode: dto.postalCode ?? null,
				country: dto.country,
				isDefault: dto.isDefault ?? false,
			});
			return manager.save(address);
		});
	}

	async getAddresses(userId: string): Promise<Address[]> {
		const user = await this.userRepository.findOne({ where: { userId } });
		if (!user) {
			throw new NotFoundException('User not found');
		}
		return this.addressRepository.find({ where: { user: { id: user.id } }, order: { createdAt: 'DESC' } });
	}

	async updateAddress(id: string, dto: UpdateAddressDto): Promise<Address> {
		const address = await this.addressRepository.findOne({ where: { id } });
		if (!address) {
			throw new NotFoundException('Address not found');
		}
		Object.assign(address, dto);
		return this.addressRepository.save(address);
	}

	async deleteAddress(id: string): Promise<{ success: boolean; message: string }> {
		const address = await this.addressRepository.findOne({ where: { id } });
		if (!address) {
			throw new NotFoundException('Address not found');
		}
		await this.addressRepository.remove(address);
		return { success: true, message: 'Address deleted successfully' };
	}

	async setDefaultAddress(id: string): Promise<Address> {
		const address = await this.addressRepository.findOne({ where: { id }, relations: ['user'] });
		if (!address) {
			throw new NotFoundException('Address not found');
		}

		return this.dataSource.transaction(async (manager) => {
			await manager.update(Address, { user: { id: address.user.id } }, { isDefault: false });
			address.isDefault = true;
			return manager.save(address);
		});
	}
}
