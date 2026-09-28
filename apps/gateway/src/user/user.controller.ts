import { Controller, Get, Post, Body, Param, HttpCode, HttpStatus, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { LoginUserDto, RegisterUserDto } from './dto/user.dto';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { GetUser } from '../common/decorator/get-user.decorator';
import { MediaService } from '@lib/media';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly mediaService: MediaService,
  ) { }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: RegisterUserDto) {
    return this.userService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
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

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(@GetUser('userId') userId: string, @UploadedFile() file: Express.Multer.File) {
    const objectPath = await this.mediaService.uploadFile(file, 'avatars');
    return this.userService.updateAvatar(userId, objectPath);
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
