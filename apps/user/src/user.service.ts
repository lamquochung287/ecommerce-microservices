import {
	Injectable,
	ConflictException,
	UnauthorizedException,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { LoginUserDTO } from './dto/login-user.dto';
import { RegisterUserDTO } from './dto/register-user.dto';
import { CachedService } from '@lib/cached';

@Injectable()
export class UserService {
	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly cachedService: CachedService,
	) { }

	async register(dto: RegisterUserDTO): Promise<User> {
		const existingUser = await this.userRepository.findOne({
			where: { email: dto.email },
		});

		if (existingUser) {
			throw new ConflictException('Email already exists');
		}

		// Hash password before saving
		const hashedPassword = await bcrypt.hash(dto.password, 10);

		const user = this.userRepository.create({
			...dto,
			password: hashedPassword,
		});

		return await this.userRepository.save(user);
	}

	async login(dto: LoginUserDTO): Promise<any> {
		const user = await this.userRepository.findOne({
			where: { email: dto.email },
		});

		if (!user) {
			throw new UnauthorizedException('Invalid credentials');
		}

		// Verify hashed password
		const isPasswordMatch = await bcrypt.compare(dto.password, user.password);
		if (!isPasswordMatch) {
			throw new UnauthorizedException('Invalid credentials');
		}

		// Generate access and refresh tokens
		const tokens = await this.generateTokens(user.userId, user.email);

		// Store refresh token in Redis (TTL: 7 days)
		const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
		await this.cachedService.set(
			`refresh_token:${user.userId}:${tokens.sessionId}`,
			tokens.refreshToken,
			SEVEN_DAYS_IN_SECONDS,
		);

		// Return tokens and basic user info (exclude password)
		return {
			...tokens,
			user: {
				id: user.id,
				email: user.email,
				fullName: user.fullName,
			},
		};
	}

	private async generateTokens(userId: string, email: string) {
		const sessionId = crypto.randomUUID();
		const payload = { sub: userId, email, sessionId };

		const accessTokenSecret =
			this.configService.get<string>('JWT_ACCESS_SECRET') || 'access_secret';
		const accessTokenExpiration: string =
			this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m';
		const refreshTokenSecret =
			this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh_secret';
		const refreshTokenExpiration: string =
			this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d';

		const [accessToken, refreshToken] = await Promise.all([
			this.jwtService.signAsync(payload, {
				secret: accessTokenSecret,
				expiresIn: accessTokenExpiration as unknown as number,
			}),
			this.jwtService.signAsync(payload, {
				secret: refreshTokenSecret,
				expiresIn: refreshTokenExpiration as unknown as number,
			}),
		]);

		return {
			accessToken,
			refreshToken,
			sessionId
		};
	}

	async logout(userId: string, sessionId: string) {
		await this.cachedService.del(`refresh_token:${userId}:${sessionId}`);
		return { success: true, message: `Logged out successfully ${userId}` };
	}

	async getProfile(userId: string): Promise<User> {
		const user = await this.userRepository.findOne({
			where: { userId: userId },
		});

		if (!user) {
			throw new NotFoundException('User not found');
		}

		return user;
	}

	async getAllUsers(): Promise<User[]> {
		return await this.userRepository.find();
	}

	async findIdByUserId(userId: string): Promise<number | null> {
		const user = await this.userRepository.findOne({
			where: { userId },
		});
		if (!user) {
			throw new NotFoundException('User not found');
		}
		return user.id;
	}
}
