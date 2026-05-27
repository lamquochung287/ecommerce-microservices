import { Controller } from '@nestjs/common';
import { UserService } from './user.service';
import { MessagePattern } from '@nestjs/microservices';
import { CMD } from '@lib/common/constant/cmd';
import { LoginUserDTO } from './dto/login-user.dto';
import { RegisterUserDTO } from './dto/register-user.dto';
import { USER_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';

@Controller()
export class UserController {
	constructor(private readonly userService: UserService) { }

	@MessagePattern({ cmd: USER_MESSAGE_PATTERN.REGISTER_USER })
	async register(dto: RegisterUserDTO): Promise<any> {
		return await this.userService.register(dto);
	}

	@MessagePattern({ cmd: USER_MESSAGE_PATTERN.LOGIN_USER })
	async login(dto: LoginUserDTO): Promise<any> {
		return await this.userService.login(dto);
	}

	@MessagePattern({ cmd: USER_MESSAGE_PATTERN.LOGOUT_USER })
	async logout(data: { userId: string; sessionId: string }): Promise<any> {
		return await this.userService.logout(data.userId, data.sessionId);
	}

	@MessagePattern({ cmd: CMD.GET_USER_INFO })
	async getProfile(userId: string): Promise<any> {
		return await this.userService.getProfile(userId);
	}
}
