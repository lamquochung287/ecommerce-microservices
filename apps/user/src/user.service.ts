import {
	Injectable,
	ConflictException,
	UnauthorizedException,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { LoginUserDTO } from './dto/login-user.dto';
import { RegisterUserDTO } from './dto/register-user.dto';

@Injectable()
export class UserService {
	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
	) {}

	async register(dto: RegisterUserDTO): Promise<User> {
		const existingUser = await this.userRepository.findOne({
			where: { email: dto.email },
		});

		if (existingUser) {
			throw new ConflictException('Email already exists');
		}

		const user = this.userRepository.create(dto);
		return await this.userRepository.save(user);
	}

	async login(dto: LoginUserDTO): Promise<User> {
		const user = await this.userRepository.findOne({
			where: { email: dto.email },
		});

		if (!user || user.password !== dto.password) {
			throw new UnauthorizedException('Invalid credentials');
		}

		return user;
	}

	logout(userId: string) {
		// Logic for logout if needed (e.g., token invalidation)
		return { success: true, message: `Logged out successfully ${userId}` };
	}

	async getProfile(userId: string): Promise<User> {
		const user = await this.userRepository.findOne({
			where: { id: userId },
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		return user;
	}

	async getAllUsers(): Promise<User[]> {
		return await this.userRepository.find();
	}
}
