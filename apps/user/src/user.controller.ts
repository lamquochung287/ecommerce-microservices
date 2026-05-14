import { Controller } from '@nestjs/common';
import { UserService } from './user.service';
import { MessagePattern } from '@nestjs/microservices';
import { CMD } from '@lib/common/constant/cmd';
import { LoginUserDTO } from './dto/login-user.dto';
import { RegisterUserDTO } from './dto/register-user.dto';

@Controller()
export class UserController {
	constructor(private readonly userService: UserService) {}

	@MessagePattern({ cmd: CMD.REGISTER })
	async register(dto: RegisterUserDTO): Promise<any> {
		return await this.userService.register(dto);
	}

	@MessagePattern({ cmd: CMD.LOGIN })
	async login(dto: LoginUserDTO): Promise<any> {
		return await this.userService.login(dto);
	}

	@MessagePattern({ cmd: CMD.LOGOUT })
	async logout(userId: string): Promise<any> {
		return await this.userService.logout(userId);
	}

	@MessagePattern({ cmd: CMD.GET_USER_INFO })
	async getProfile(userId: string): Promise<any> {
		return await this.userService.getProfile(userId);
	}
}
