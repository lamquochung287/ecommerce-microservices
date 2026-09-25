import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '@lib/database';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { CachedModule } from '@lib/cached';
import { CommonConfigModule } from '@lib/common';
import { HealthModule } from './health/health.module';
import { AddressModule } from './address/address.module';
import { RoleModule } from './role/role.module';

@Module({
	imports: [
		CommonConfigModule,
		DatabaseModule,
		TypeOrmModule.forFeature([User]),
		JwtModule.register({}),
		CachedModule,
		HealthModule,
		AddressModule,
		RoleModule,
	],
	controllers: [UserController],
	providers: [UserService],

})
export class UserModule { }
