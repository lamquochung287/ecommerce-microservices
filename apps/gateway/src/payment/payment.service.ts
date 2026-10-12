import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { PAYMENT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { PaymentWebhookDto } from '../../../payment/src/dto/charge-payment.dto';

@Injectable()
export class PaymentService {
	constructor(
		@Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
		private readonly paymentClient: ClientProxy,
		private readonly tcpResilience: TcpResilienceService,
	) {}

	private async send(cmd: string, payload: unknown, action: string) {
		try {
			return await this.tcpResilience.send(
				NAME_SERVICE_TCP.PAYMENT_SERVICE,
				this.paymentClient,
				{ cmd },
				payload,
			);
		} catch (error) {
			MicroserviceErrorHandler.handleError(error, action, 'Payment service');
		}
	}

	handleWebhook(dto: PaymentWebhookDto) {
		return this.send(
			PAYMENT_MESSAGE_PATTERN.HANDLE_WEBHOOK,
			dto,
			'handle payment webhook',
		);
	}

	getTransaction(orderId: string) {
		return this.send(
			PAYMENT_MESSAGE_PATTERN.GET_TRANSACTION,
			{ orderId },
			'get transaction',
		);
	}
}
