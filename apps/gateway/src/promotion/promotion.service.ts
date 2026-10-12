import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { PROMOTION_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import {
	CreateVoucherDto,
	ApplyVoucherDto,
} from '../../../promotion/src/dto/voucher.dto';

@Injectable()
export class PromotionService {
	constructor(
		@Inject(NAME_SERVICE_TCP.PROMOTION_SERVICE)
		private readonly promotionClient: ClientProxy,
		private readonly tcpResilience: TcpResilienceService,
	) {}

	private async send(cmd: string, payload: unknown, action: string) {
		try {
			return await this.tcpResilience.send(
				NAME_SERVICE_TCP.PROMOTION_SERVICE,
				this.promotionClient,
				{ cmd },
				payload,
			);
		} catch (error) {
			MicroserviceErrorHandler.handleError(error, action, 'Promotion service');
		}
	}

	createVoucher(dto: CreateVoucherDto) {
		return this.send(
			PROMOTION_MESSAGE_PATTERN.CREATE_VOUCHER,
			dto,
			'create voucher',
		);
	}

	getVouchers() {
		return this.send(
			PROMOTION_MESSAGE_PATTERN.GET_VOUCHERS,
			{},
			'get vouchers',
		);
	}

	getAvailableVouchers() {
		return this.send(
			PROMOTION_MESSAGE_PATTERN.GET_AVAILABLE_VOUCHERS,
			{},
			'get available vouchers',
		);
	}

	applyVoucher(dto: ApplyVoucherDto) {
		return this.send(
			PROMOTION_MESSAGE_PATTERN.APPLY_VOUCHER,
			dto,
			'apply voucher',
		);
	}
}
