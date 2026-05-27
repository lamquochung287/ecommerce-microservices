import { forwardRef, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { GatewayModule } from '../gateway.module';

@Module({
  imports: [forwardRef(() => GatewayModule)],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule { }
