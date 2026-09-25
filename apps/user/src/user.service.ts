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
import { RoleService } from './role/role.service';

@Injectable()
export class UserService {
	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly cachedService: CachedService,
		private readonly roleService: RoleService,
	) { }

	// Permissions hiệu lực = OR bitmask tất cả role user đang có. Fallback về field User.permissions cũ
	// nếu user chưa được gán role nào (giữ tương thích ngược, tránh user cũ mất quyền truy cập đột ngột).
	private async resolvePermissions(user: User): Promise<number> {
		const rolePermissions = await this.roleService.getEffectivePermissions(user.id);
		return rolePermissions ?? Number(user.permissions);
	}

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
				id: user.userId,
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

	async verifyToken(token: string): Promise<any> {
		try {
			const accessTokenSecret =
				this.configService.get<string>('JWT_ACCESS_SECRET') || 'access_secret';
			const payload = await this.jwtService.verifyAsync(token, {
				secret: accessTokenSecret,
			});

			// Check if session exists in Redis to ensure it hasn't been revoked
			const refreshToken = await this.cachedService.get(
				`refresh_token:${payload.sub}:${payload.sessionId}`,
			);

			if (!refreshToken) {
				throw new UnauthorizedException('Session revoked or expired');
			}

			// Get latest user info and permissions
			const user = await this.userRepository.findOne({
				where: { userId: payload.sub }
			});

			if (!user || !user.isActive) {
				throw new UnauthorizedException('User not found or inactive');
			}

			return {
				userId: user.userId,
				email: user.email,
				fullName: user.fullName,
				permissions: await this.resolvePermissions(user),
				sessionId: payload.sessionId,
			};
		} catch (error) {
			throw new UnauthorizedException('Invalid or expired token');
		}
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

	async updateAvatar(userId: string, avatarUrl: string): Promise<User> {
		const user = await this.userRepository.findOne({ where: { userId } });
		if (!user) {
			throw new NotFoundException('User not found');
		}
		user.avatarUrl = avatarUrl;
		return this.userRepository.save(user);
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
