import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UserService } from './user.service';
import { LoginUserDto, RegisterUserDto } from './dto/user.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.userService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginUserDto) {
    return this.userService.login(dto);
  }

  @Post('logout')
  logout(@Body() body: { userId: string; sessionId: string }) {
    return this.userService.logout(body.userId, body.sessionId);
  }

  @Get('profile/:userId')
  getProfile(@Param('userId') userId: string) {
    return this.userService.getProfile(userId);
  }

  @Get()
  getAllUsers() {
    return this.userService.getAllUsers();
  }

  @Get('id/:userId')
  findIdByUserId(@Param('userId') userId: string) {
    return this.userService.findIdByUserId(userId);
  }
}
