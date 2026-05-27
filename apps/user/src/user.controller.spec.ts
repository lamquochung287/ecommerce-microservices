import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
	let userController: UserController;

	beforeEach(async () => {
		const app: TestingModule = await Test.createTestingModule({
			controllers: [UserController],
			providers: [
				{
					provide: UserService,
					useValue: {
						register: jest.fn(),
						login: jest.fn(),
						logout: jest.fn(),
						getProfile: jest.fn(),
					},
				},
			],
		}).compile();

		userController = app.get<UserController>(UserController);
	});

	describe('defined', () => {
		it('should be defined', () => {
			expect(userController).toBeDefined();
		});
	});
});
