/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- mock jest.fn()/supertest trả any */
import {
	CanActivate,
	ExecutionContext,
	INestApplication,
	ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ShippingWebhookController } from './shipping-webhook.controller';
import { ShipmentController } from './shipment.controller';
import { ShippingService } from './shipping.service';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';

const ORDER_ID = 'b1a2c3d4-1111-4222-8333-444455556666';

class FakeJwtGuard implements CanActivate {
	canActivate(context: ExecutionContext) {
		context.switchToHttp().getRequest().user = { userId: 'admin' };
		return true;
	}
}

describe('Shipping routes', () => {
	let app: INestApplication;
	let shippingService: {
		handleWebhook: jest.Mock;
		simulateDelivery: jest.Mock;
		getShipment: jest.Mock;
	};
	let permissionsAllowed: boolean;

	beforeEach(async () => {
		permissionsAllowed = true;
		shippingService = {
			handleWebhook: jest.fn().mockResolvedValue({ processed: true }),
			simulateDelivery: jest.fn().mockResolvedValue({ delivered: true }),
			getShipment: jest.fn().mockResolvedValue({ orderId: ORDER_ID }),
		};
		const moduleRef = await Test.createTestingModule({
			controllers: [ShippingWebhookController, ShipmentController],
			providers: [{ provide: ShippingService, useValue: shippingService }],
		})
			.overrideGuard(JwtAuthGuard)
			.useClass(FakeJwtGuard)
			.overrideGuard(PermissionGuard)
			.useValue({ canActivate: () => permissionsAllowed })
			.compile();
		app = moduleRef.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				forbidNonWhitelisted: true,
				transform: true,
			}),
		);
		await app.init();
	});

	afterEach(async () => {
		await app.close();
	});

	it('webhook chuyển nguyên payload và đúng thứ tự key (HMAC trên JSON.stringify)', async () => {
		// Thứ tự key cố ý không theo alphabet.
		const raw =
			'{"payload":{"eventId":"e1","orderId":"' +
			ORDER_ID +
			'","trackingCode":"SIM-1","status":"DELIVERED","deliveredAt":"2030-01-01T00:00:00.000Z"},"signature":"abc"}';
		const res = await request(app.getHttpServer())
			.post('/webhooks/shipping')
			.set('Content-Type', 'application/json')
			.send(raw);
		expect(res.status).toBe(201);
		const dto = shippingService.handleWebhook.mock.calls[0][0];
		expect(JSON.stringify(dto.payload)).toBe(
			JSON.stringify(JSON.parse(raw).payload),
		);
		expect(dto.signature).toBe('abc');
	});

	it('webhook thiếu signature hoặc payload -> 400', async () => {
		const noSig = await request(app.getHttpServer())
			.post('/webhooks/shipping')
			.send({ payload: { a: 1 } });
		const noPayload = await request(app.getHttpServer())
			.post('/webhooks/shipping')
			.send({ signature: 'x' });
		expect(noSig.status).toBe(400);
		expect(noPayload.status).toBe(400);
		expect(shippingService.handleWebhook).not.toHaveBeenCalled();
	});

	it('POST :orderId/deliver và GET :orderId gọi Shipping với orderId UUID', async () => {
		const deliver = await request(app.getHttpServer()).post(
			`/shipments/${ORDER_ID}/deliver`,
		);
		const get = await request(app.getHttpServer()).get(
			`/shipments/${ORDER_ID}`,
		);
		expect(deliver.status).toBe(201);
		expect(get.status).toBe(200);
		expect(shippingService.simulateDelivery).toHaveBeenCalledWith(ORDER_ID);
		expect(shippingService.getShipment).toHaveBeenCalledWith(ORDER_ID);
	});

	it('orderId không phải UUID -> 400', async () => {
		const res = await request(app.getHttpServer()).post(
			'/shipments/not-a-uuid/deliver',
		);
		expect(res.status).toBe(400);
		expect(shippingService.simulateDelivery).not.toHaveBeenCalled();
	});

	it('thiếu quyền ORDER -> 403, không gọi Shipping', async () => {
		permissionsAllowed = false;
		const res = await request(app.getHttpServer()).post(
			`/shipments/${ORDER_ID}/deliver`,
		);
		expect(res.status).toBe(403);
		expect(shippingService.simulateDelivery).not.toHaveBeenCalled();
	});
});
