import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { SHIPPING_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { HandleShippingWebhookDto } from '../../../shipping/src/dto/shipping.dto';

@Injectable()
export class ShippingService {
	constructor(
		@Inject(NAME_SERVICE_TCP.SHIPPING_SERVICE)
		private readonly shippingClient: ClientProxy,
		private readonly tcpResilience: TcpResilienceService,
	) {}

	private async send(cmd: string, payload: unknown, action: string) {
		try {
			return await this.tcpResilience.send(
				NAME_SERVICE_TCP.SHIPPING_SERVICE,
				this.shippingClient,
				{ cmd },
				payload,
			);
		} catch (error) {
			MicroserviceErrorHandler.handleError(error, action, 'Shipping service');
		}
	}

	/** Chuyển nguyên `{payload, signature}`: chữ ký tính trên JSON.stringify(payload) nên không được đổi thứ tự key. */
	handleWebhook(dto: HandleShippingWebhookDto) {
		return this.send(
			SHIPPING_MESSAGE_PATTERN.HANDLE_WEBHOOK,
			{ payload: dto.payload, signature: dto.signature },
			'handle shipping webhook',
		);
	}

	simulateDelivery(orderId: string) {
		return this.send(
			SHIPPING_MESSAGE_PATTERN.SIMULATE_DELIVERY,
			{ orderId },
			'simulate delivery',
		);
	}

	getShipment(orderId: string) {
		return this.send(
			SHIPPING_MESSAGE_PATTERN.GET_SHIPMENT,
			{ orderId },
			'get shipment',
		);
	}
}
