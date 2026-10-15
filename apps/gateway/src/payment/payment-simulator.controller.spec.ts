/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
import {
	ConflictException,
	INestApplication,
	MiddlewareConsumer,
	Module,
	NestModule,
	Controller,
	Get,
	ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { PaymentSimulatorController } from './payment-simulator.controller';
import { PaymentService } from './payment.service';
import { escapeHtml, renderSimulatorPage } from './simulator-page';
import {
	API_KEY_EXEMPT_ROUTES,
	RequestTrackerMiddleware,
} from '../common/middleware/request-tracker.middleware';

const API_KEY = 'test-api-key';
const INTENT_ID = 'd4f1b8f2-6a63-4d0b-9c3a-7a3f2b7b0c11';

@Controller('orders')
class ProtectedController {
	@Get()
	list() {
		return [];
	}
}

describe('PaymentSimulatorController (HTTP)', () => {
	let app: INestApplication;
	let paymentService: {
		getIntent: jest.Mock;
		simulatePayment: jest.Mock;
		handleWebhook: jest.Mock;
	};
	let nodeEnv: string;

	// Thứ tự key cố ý không theo alphabet: chữ ký HMAC tính trên JSON.stringify(payload).
	const signedPayload = {
		eventId: 'evt-1',
		intentId: INTENT_ID,
		orderId: 'order-1',
		amount: 100,
		status: 'SUCCEEDED',
	};

	beforeEach(async () => {
		nodeEnv = 'development';
		paymentService = {
			getIntent: jest.fn().mockResolvedValue({
				intentId: INTENT_ID,
				orderId: 'order-1',
				amount: 100,
				status: 'PENDING',
				expiresAt: '2030-01-01T00:00:00.000Z',
				expired: false,
			}),
			simulatePayment: jest
				.fn()
				.mockResolvedValue({ payload: signedPayload, signature: 'sig-abc' }),
			handleWebhook: jest
				.fn()
				.mockResolvedValue({ processed: true, alreadyProcessed: false }),
		};

		@Module({
			controllers: [PaymentSimulatorController, ProtectedController],
			providers: [
				{ provide: PaymentService, useValue: paymentService },
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) =>
							key === 'API_KEY'
								? API_KEY
								: key === 'NODE_ENV'
									? nodeEnv
									: undefined,
						),
					},
				},
				RequestTrackerMiddleware,
			],
		})
		class TestModule implements NestModule {
			configure(consumer: MiddlewareConsumer) {
				consumer
					.apply(RequestTrackerMiddleware)
					.exclude(...API_KEY_EXEMPT_ROUTES)
					.forRoutes('*');
			}
		}

		const moduleRef = await Test.createTestingModule({
			imports: [TestModule],
		}).compile();
		app = moduleRef.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
		);
		await app.init();
	});

	afterEach(async () => {
		await app.close();
	});

	it('GET trang simulator không cần x-api-key (non-prod), trả HTML có 2 form', async () => {
		const res = await request(app.getHttpServer()).get(
			`/simulator/pay/${INTENT_ID}`,
		);
		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toContain('text/html');
		expect(res.text).toContain(`/simulator/pay/${INTENT_ID}/success`);
		expect(res.text).toContain(`/simulator/pay/${INTENT_ID}/fail`);
		expect(res.text).not.toContain('<script');
		expect(paymentService.getIntent).toHaveBeenCalledWith(INTENT_ID);
	});

	it('route khác vẫn bắt buộc x-api-key (exclude không quá rộng)', async () => {
		const denied = await request(app.getHttpServer()).get('/orders');
		expect(denied.status).toBe(401);
		const allowed = await request(app.getHttpServer())
			.get('/orders')
			.set('x-api-key', API_KEY);
		expect(allowed.status).toBe(200);
	});

	it('production -> 404 cho cả GET và POST, không gọi Payment', async () => {
		nodeEnv = 'production';
		const get = await request(app.getHttpServer()).get(
			`/simulator/pay/${INTENT_ID}`,
		);
		const post = await request(app.getHttpServer()).post(
			`/simulator/pay/${INTENT_ID}/success`,
		);
		expect(get.status).toBe(404);
		expect(post.status).toBe(404);
		expect(paymentService.getIntent).not.toHaveBeenCalled();
		expect(paymentService.simulatePayment).not.toHaveBeenCalled();
		expect(paymentService.handleWebhook).not.toHaveBeenCalled();
	});

	it('bấm success: SIMULATE_PAYMENT rồi HANDLE_WEBHOOK với đúng payload/signature', async () => {
		const res = await request(app.getHttpServer()).post(
			`/simulator/pay/${INTENT_ID}/success`,
		);
		expect(res.status).toBe(200);
		expect(res.headers['content-type']).toContain('text/html');
		expect(paymentService.simulatePayment).toHaveBeenCalledWith(
			INTENT_ID,
			'success',
		);
		expect(paymentService.handleWebhook).toHaveBeenCalledTimes(1);
		const arg = paymentService.handleWebhook.mock.calls[0][0];
		expect(arg.signature).toBe('sig-abc');
		// Giữ nguyên thứ tự key để HMAC trên JSON.stringify còn khớp.
		expect(JSON.stringify(arg.payload)).toBe(JSON.stringify(signedPayload));
		expect(
			paymentService.simulatePayment.mock.invocationCallOrder[0],
		).toBeLessThan(paymentService.handleWebhook.mock.invocationCallOrder[0]);
	});

	it('bấm fail truyền result=fail', async () => {
		await request(app.getHttpServer()).post(`/simulator/pay/${INTENT_ID}/fail`);
		expect(paymentService.simulatePayment).toHaveBeenCalledWith(
			INTENT_ID,
			'fail',
		);
	});

	it('bấm lại (webhook trùng) -> trang báo đã ghi nhận', async () => {
		paymentService.handleWebhook.mockResolvedValue({
			processed: false,
			alreadyProcessed: true,
		});
		const res = await request(app.getHttpServer()).post(
			`/simulator/pay/${INTENT_ID}/success`,
		);
		expect(res.status).toBe(200);
		expect(res.text).toContain('webhook trùng');
	});

	it('result lạ hoặc intentId không phải UUID -> 400, không gọi Payment', async () => {
		const badResult = await request(app.getHttpServer()).post(
			`/simulator/pay/${INTENT_ID}/maybe`,
		);
		const badId = await request(app.getHttpServer()).post(
			'/simulator/pay/not-a-uuid/success',
		);
		expect(badResult.status).toBe(400);
		expect(badId.status).toBe(400);
		expect(paymentService.simulatePayment).not.toHaveBeenCalled();
	});

	it('Payment từ chối webhook -> trang lỗi HTML với status tương ứng', async () => {
		paymentService.handleWebhook.mockRejectedValue(
			new ConflictException('Intent không còn hợp lệ'),
		);
		const res = await request(app.getHttpServer()).post(
			`/simulator/pay/${INTENT_ID}/success`,
		);
		expect(res.status).toBe(409);
		expect(res.headers['content-type']).toContain('text/html');
		expect(res.text).toContain('Intent không còn hợp lệ');
	});
});

describe('simulator-page', () => {
	it('escape giá trị chèn vào HTML', () => {
		expect(escapeHtml('<img src=x onerror="a()">&\'')).toBe(
			'&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;',
		);
		const html = renderSimulatorPage({
			intentId: INTENT_ID,
			orderId: '<script>alert(1)</script>',
			amount: 1,
			status: 'PENDING',
			expiresAt: null,
			expired: false,
		});
		expect(html).not.toContain('<script>alert(1)');
		expect(html).toContain('&lt;script&gt;');
	});

	it('cảnh báo khi intent hết hạn hoặc đã huỷ', () => {
		const html = renderSimulatorPage({
			intentId: INTENT_ID,
			orderId: 'o',
			amount: 1,
			status: 'CANCELLED',
			expiresAt: '2020-01-01T00:00:00.000Z',
			expired: true,
		});
		expect(html).toContain('quá hạn');
		expect(html).toContain('đã bị huỷ');
	});
});
