import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ADDRESS_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { AddressService } from './address.service';
import { CreateAddressDto, UpdateAddressDto } from './address.dto';

@Controller()
export class AddressController {
	constructor(private readonly addressService: AddressService) {}

	@MessagePattern({ cmd: ADDRESS_MESSAGE_PATTERN.CREATE_ADDRESS })
	createAddress(@Payload() dto: CreateAddressDto) {
		return this.addressService.createAddress(dto);
	}

	@MessagePattern({ cmd: ADDRESS_MESSAGE_PATTERN.GET_ADDRESSES })
	getAddresses(@Payload() data: { userId: string }) {
		return this.addressService.getAddresses(data.userId);
	}

	@MessagePattern({ cmd: ADDRESS_MESSAGE_PATTERN.UPDATE_ADDRESS })
	updateAddress(@Payload() payload: { id: string; dto: UpdateAddressDto }) {
		return this.addressService.updateAddress(payload.id, payload.dto);
	}

	@MessagePattern({ cmd: ADDRESS_MESSAGE_PATTERN.DELETE_ADDRESS })
	deleteAddress(@Payload() data: { id: string }) {
		return this.addressService.deleteAddress(data.id);
	}

	@MessagePattern({ cmd: ADDRESS_MESSAGE_PATTERN.SET_DEFAULT_ADDRESS })
	setDefaultAddress(@Payload() data: { id: string }) {
		return this.addressService.setDefaultAddress(data.id);
	}
}
