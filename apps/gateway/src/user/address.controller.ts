import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { UserService } from './user.service';
import { CreateAddressDto, UpdateAddressDto } from '../../../user/src/address/address.dto';

@ApiTags('Address Book')
@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressController {
  constructor(private readonly userService: UserService) {}

  @Post()
  createAddress(@Req() req: Request, @Body() dto: Omit<CreateAddressDto, 'userId'>) {
    return this.userService.createAddress({ ...dto, userId: req['user'].userId });
  }

  @Get()
  getAddresses(@Req() req: Request) {
    return this.userService.getAddresses(req['user'].userId);
  }

  @Put(':id')
  updateAddress(@Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.userService.updateAddress(id, dto);
  }

  @Delete(':id')
  deleteAddress(@Param('id') id: string) {
    return this.userService.deleteAddress(id);
  }

  @Post(':id/default')
  setDefaultAddress(@Param('id') id: string) {
    return this.userService.setDefaultAddress(id);
  }
}
