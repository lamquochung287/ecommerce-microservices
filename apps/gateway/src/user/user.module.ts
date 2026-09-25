import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { AddressController } from './address.controller';
import { RoleController } from './role.controller';


@Module({
  imports: [],
  controllers: [UserController, AddressController, RoleController],
  providers: [UserService],
})
export class UserModule { }
