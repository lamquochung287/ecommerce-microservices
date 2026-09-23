import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { LoginUserDto, RegisterUserDto } from './dto/user.dto';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { GetUser } from '../common/decorator/get-user.decorator';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
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
  @UseGuards(JwtAuthGuard)
  getProfile(@GetUser() user: string) {
    return this.userService.getProfile(user);
  }

  // @Get()
  // getAllUsers() {
  //   return this.userService.getAllUsers();
  // }

  // @Get('id/:userId')
  // findIdByUserId(@Param('userId') userId: string) {
  //   return this.userService.findIdByUserId(userId);
  // }
}
