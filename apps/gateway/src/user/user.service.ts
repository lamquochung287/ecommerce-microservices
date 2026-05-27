import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { LoginUserDto, RegisterUserDto } from './dto/user.dto';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { USER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name)

  constructor(@Inject(NAME_SERVICE_TCP.USER_SERVICE) private readonly userClient: ClientProxy) { }

  async register(dto: RegisterUserDto) {
    try {
      this.logger.log(`Registering user: ${dto.email}`)
      return await firstValueFrom(this.userClient.send({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER }, dto).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ))
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'register user', 'User service')
    }
  }

  async login(dto: LoginUserDto) {
    try {
      this.logger.log(`User login attempt: ${dto.email}`)
      return await firstValueFrom(this.userClient.send({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER }, dto).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ))
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'login user', 'User service')
    }
  }

  logout(userId: string, sessionId: string) {
    // Logic will be implemented here
  }

  getProfile(userId: string) {
    // Logic will be implemented here
  }

  getAllUsers() {
    // Logic will be implemented here
  }

  findIdByUserId(userId: string) {
    // Logic will be implemented here
  }
}
