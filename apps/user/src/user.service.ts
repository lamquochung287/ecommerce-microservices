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
import { BcryptConcurrencyLimiter } from './bcrypt-concurrency-limiter';

// VERIFY_TOKEN chạy ở mọi request qua Gateway nên lấy user và quyền trong một truy vấn, chỉ chọn cột cần dùng.
// Permissions hiệu lực = OR bitmask tất cả role user đang có (bit_or trả NULL khi chưa có role nào). Khi đó fallback
// về cột users.permissions cũ để user cũ không mất quyền truy cập đột ngột. Bỏ qua user đã xoá mềm như findOne.
const VERIFY_USER_SQL = `
	SELECT u."userId", u."email", u."fullName", u."isActive",
		COALESCE(
			(SELECT bit_or(r."permissions") FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = u."id"),
			u."permissions"
		) AS "permissions"
	FROM "users" u
	WHERE u."userId" = $1 AND u."deletedAt" IS NULL
	LIMIT 1`;

// Dùng khi quyền đã nằm trong access token: chỉ cần xác nhận user còn tồn tại và đang active (không join role).
const VERIFY_ACTIVE_USER_SQL = `
	SELECT u."userId", u."email", u."fullName", u."isActive"
	FROM "users" u
	WHERE u."userId" = $1 AND u."deletedAt" IS NULL
	LIMIT 1`;

@Injectable()
export class UserService {
	// Giới hạn bcrypt đồng thời để đợt đăng nhập dồn dập bị từ chối nhanh (429) thay vì xếp hàng quá timeout.
	private readonly bcryptLimiter: BcryptConcurrencyLimiter;

	constructor(
		@InjectRepository(User)
		private readonly userRepository: Repository<User>,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly cachedService: CachedService,
	) {
		this.bcryptLimiter = new BcryptConcurrencyLimiter(
			Number(this.configService.get('BCRYPT_MAX_CONCURRENCY', 4)),
			Number(this.configService.get('BCRYPT_QUEUE_LIMIT', 300)),
			Number(this.configService.get('BCRYPT_QUEUE_WAIT_MS', 8000)),
		);
	}

	async register(dto: RegisterUserDTO): Promise<User> {
		const existingUser = await this.userRepository.findOne({
			where: { email: dto.email },
		});

		if (existingUser) {
			throw new ConflictException('Email already exists');
		}

		// Hash password before saving
		const hashedPassword = await this.bcryptLimiter.run(() =>
			bcrypt.hash(dto.password, 10),
		);

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
		const isPasswordMatch = await this.bcryptLimiter.run(() =>
			bcrypt.compare(dto.password, user.password),
		);
		if (!isPasswordMatch) {
			throw new UnauthorizedException('Invalid credentials');
		}

		// Quyền hiệu lực (OR bitmask role) để nhúng vào access token cho client đọc
		const rows = await this.userRepository.query(VERIFY_USER_SQL, [
			user.userId,
		]);
		const permissions = Number(rows[0]?.permissions ?? 0);

		// Generate access and refresh tokens
		const tokens = await this.generateTokens(
			user.userId,
			user.email,
			user.fullName,
			permissions,
		);

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

	private async generateTokens(
		userId: string,
		email: string,
		fullName: string,
		permissions: number,
	) {
		const sessionId = crypto.randomUUID();
		// Access token mang sẵn thông tin user và quyền hiệu lực lúc login để VERIFY_TOKEN không phải tính lại.
		// Đổi role chỉ có hiệu lực khi access token mới được cấp (tối đa JWT_ACCESS_EXPIRATION).
		const accessPayload = {
			sub: userId,
			userId,
			email,
			fullName,
			permissions,
			sessionId,
		};
		const refreshPayload = { sub: userId, email, sessionId };

		const accessTokenSecret =
			this.configService.get<string>('JWT_ACCESS_SECRET') || 'access_secret';
		const accessTokenExpiration: string =
			this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m';
		const refreshTokenSecret =
			this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh_secret';
		const refreshTokenExpiration: string =
			this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d';

		const [accessToken, refreshToken] = await Promise.all([
			this.jwtService.signAsync(accessPayload, {
				secret: accessTokenSecret,
				expiresIn: accessTokenExpiration as unknown as number,
			}),
			this.jwtService.signAsync(refreshPayload, {
				secret: refreshTokenSecret,
				expiresIn: refreshTokenExpiration as unknown as number,
			}),
		]);

		return {
			accessToken,
			refreshToken,
			sessionId,
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

			// Quyền lấy từ token (đã ký lúc login) nên không tính lại bit_or theo role. Token cấp trước khi payload có
			// `permissions` vẫn dùng truy vấn đầy đủ để không mất quyền đột ngột.
			const permissionsInToken = typeof payload.permissions === 'number';

			// Redis (phiên chưa bị thu hồi) và Postgres (user còn tồn tại/active) độc lập nhau nên chạy song song.
			const [refreshToken, rows] = await Promise.all([
				this.cachedService.get(
					`refresh_token:${payload.sub}:${payload.sessionId}`,
				),
				this.userRepository.query(
					permissionsInToken ? VERIFY_ACTIVE_USER_SQL : VERIFY_USER_SQL,
					[payload.sub],
				),
			]);

			if (!refreshToken) {
				throw new UnauthorizedException('Session revoked or expired');
			}

			const user = rows[0];
			if (!user || !user.isActive) {
				throw new UnauthorizedException('User not found or inactive');
			}

			return {
				userId: user.userId,
				email: user.email,
				fullName: user.fullName,
				permissions: permissionsInToken
					? payload.permissions
					: Number(user.permissions),
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
