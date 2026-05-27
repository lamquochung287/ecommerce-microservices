import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '@lib/database';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { CachedModule } from '@lib/cached';

@Module({
	imports: [
		DatabaseModule,
		TypeOrmModule.forFeature([User]),
		ConfigModule,
		JwtModule.register({}),
		CachedModule,
	],
	controllers: [UserController],
	providers: [UserService],
})
export class UserModule { }
