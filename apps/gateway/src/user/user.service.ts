import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { LoginUserDto, RegisterUserDto } from './dto/user.dto';
import { USER_MESSAGE_PATTERN, ADDRESS_MESSAGE_PATTERN, ROLE_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { CreateAddressDto, UpdateAddressDto } from '../../../user/src/address/address.dto';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from '../../../user/src/role/role.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  constructor(
    @Inject(NAME_SERVICE_TCP.USER_SERVICE) private readonly userClient: ClientProxy,
    private readonly tcpResilience: TcpResilienceService,
  ) { }

  async register(dto: RegisterUserDto) {
    try {
      this.logger.log(`Registering user: ${dto.email}`)
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.USER_SERVICE,
        this.userClient,
        { cmd: USER_MESSAGE_PATTERN.REGISTER_USER },
        dto,
      )
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'register user', 'User service')
    }
  }

  async login(dto: LoginUserDto) {
    try {
      this.logger.log(`User login attempt: ${dto.email}`)
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.USER_SERVICE,
        this.userClient,
        { cmd: USER_MESSAGE_PATTERN.LOGIN_USER },
        dto,
      )
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'login user', 'User service')
    }
  }

  async logout(userId: string, sessionId: string) {
    try {
      this.logger.log(`User logout attempt: ${userId}`)
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.USER_SERVICE,
        this.userClient,
        { cmd: USER_MESSAGE_PATTERN.LOGOUT_USER },
        { userId, sessionId },
      )
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'logout user', 'User services')
    }
  }

  getProfile(userId: string) {
    // Logic will be implemented here
  }

  // getAllUsers() {
  //   // Logic will be implemented here
  // }

  // findIdByUserId(userId: string) {
  //   // Logic will be implemented here
  // }

  private async send(cmd: string, payload: unknown, action: string) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.USER_SERVICE,
        this.userClient,
        { cmd },
        payload,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, action, 'User service');
    }
  }

  createAddress(dto: CreateAddressDto) {
    return this.send(ADDRESS_MESSAGE_PATTERN.CREATE_ADDRESS, dto, 'create address');
  }

  getAddresses(userId: string) {
    return this.send(ADDRESS_MESSAGE_PATTERN.GET_ADDRESSES, { userId }, 'get addresses');
  }

  updateAddress(id: string, dto: UpdateAddressDto) {
    return this.send(ADDRESS_MESSAGE_PATTERN.UPDATE_ADDRESS, { id, dto }, 'update address');
  }

  deleteAddress(id: string) {
    return this.send(ADDRESS_MESSAGE_PATTERN.DELETE_ADDRESS, { id }, 'delete address');
  }

  setDefaultAddress(id: string) {
    return this.send(ADDRESS_MESSAGE_PATTERN.SET_DEFAULT_ADDRESS, { id }, 'set default address');
  }

  createRole(dto: CreateRoleDto) {
    return this.send(ROLE_MESSAGE_PATTERN.CREATE_ROLE, dto, 'create role');
  }

  getRoles() {
    return this.send(ROLE_MESSAGE_PATTERN.GET_ROLES, {}, 'get roles');
  }

  updateRole(id: string, dto: UpdateRoleDto) {
    return this.send(ROLE_MESSAGE_PATTERN.UPDATE_ROLE, { id, dto }, 'update role');
  }

  deleteRole(id: string) {
    return this.send(ROLE_MESSAGE_PATTERN.DELETE_ROLE, { id }, 'delete role');
  }

  assignRole(dto: AssignRoleDto) {
    return this.send(ROLE_MESSAGE_PATTERN.ASSIGN_ROLE, dto, 'assign role');
  }

  removeRole(dto: AssignRoleDto) {
    return this.send(ROLE_MESSAGE_PATTERN.REMOVE_ROLE, dto, 'remove role');
  }
}
