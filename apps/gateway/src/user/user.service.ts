import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { LoginUserDto, RegisterUserDto } from './dto/user.dto';
import { USER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';

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
}
