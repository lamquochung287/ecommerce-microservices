import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { InjectDataSource } from '@nestjs/typeorm';
import { isISO8601, isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { InboxService, OutboxWriter } from '@lib/messaging';
import type { ShipmentDeliveredPayload } from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import {
	SHIPPING_PROVIDER,
	ShippingProvider,
} from '../../providers/shipping-provider.interface';
import { HandleShippingWebhookCommand } from '../handle-shipping-webhook.command';

/** Khoá inbox riêng cho webhook (tách khỏi consumer Kafka `shipping`). */
export const SHIPPING_WEBHOOK_CONSUMER = 'shipping-webhook';

interface ParsedWebhook {
	eventId: string;
	orderId: string;
	trackingCode: string;
	deliveredAt: Date;
}

export interface WebhookResult {
	processed: boolean;
	alreadyProcessed: boolean;
}

const badRequest = (message: string) =>
	new RpcException({ statusCode: 400, message });

@CommandHandler(HandleShippingWebhookCommand)
export class HandleShippingWebhookHandler implements ICommandHandler<HandleShippingWebhookCommand> {
	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		@Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
		private readonly inbox: InboxService,
		private readonly outbox: OutboxWriter,
	) {}

	async execute(command: HandleShippingWebhookCommand): Promise<WebhookResult> {
		const { payload, signature } = command.dto;

		// Chữ ký sai thì không đụng DB: không ghi inbox, không outbox.
		if (!this.provider.verifyWebhook(payload, signature)) {
			throw badRequest('Invalid webhook signature');
		}
		const webhook = this.parse(payload);

		return this.dataSource.transaction(async (manager) => {
			// Idempotent theo eventId: dấu inbox cùng TX với đổi state nên chỉ commit khi xử lý xong.
			const acquired = await this.inbox.tryAcquire(
				manager,
				SHIPPING_WEBHOOK_CONSUMER,
				webhook.eventId,
			);
			if (!acquired) return { processed: false, alreadyProcessed: true };

			const shipment = await manager.findOne(Shipment, {
				where: { orderId: webhook.orderId },
				lock: { mode: 'pessimistic_write' },
			});
			if (!shipment) {
				throw new RpcException({
					statusCode: 404,
					message: 'Shipment not found',
				});
			}
			if (shipment.trackingCode !== webhook.trackingCode) {
				throw badRequest('Webhook trackingCode does not match the shipment');
			}

			// Trạng thái khác CREATED (đã giao, đã huỷ, FAILED) là no-op: không phát event thừa.
			if (shipment.status === ShipmentStatus.CREATED) {
				await manager.update(Shipment, shipment.id, {
					status: ShipmentStatus.DELIVERED,
					deliveredAt: webhook.deliveredAt,
				});
				const event: ShipmentDeliveredPayload = {
					deliveredAt: webhook.deliveredAt.toISOString(),
				};
				await this.outbox.append(manager, {
					topic: KAFKA_TOPIC.SHIPPING_EVENTS,
					type: MESSAGE_TYPE.SHIPMENT_DELIVERED,
					orderId: shipment.orderId,
					payload: event,
				});
			}
			return { processed: true, alreadyProcessed: false };
		});
	}

	// Payload đã qua HMAC nhưng vẫn kiểm hình dạng: secret đúng không bảo đảm người ký gửi đúng schema.
	private parse(payload: Record<string, unknown>): ParsedWebhook {
		const { eventId, orderId, trackingCode, status, deliveredAt } = payload;
		// eventId là khoá inbox (cột uuid): sai định dạng phải trả 400, không để lỗi DB thành 500 và carrier retry mãi.
		if (typeof eventId !== 'string' || !isUUID(eventId)) {
			throw badRequest('Webhook eventId must be a UUID');
		}
		if (typeof orderId !== 'string' || !isUUID(orderId)) {
			throw badRequest('Webhook orderId must be a UUID');
		}
		if (typeof trackingCode !== 'string' || trackingCode.length === 0) {
			throw badRequest('Webhook trackingCode is required');
		}
		if (status !== 'DELIVERED') {
			throw badRequest('Webhook status must be DELIVERED');
		}
		if (typeof deliveredAt !== 'string' || !isISO8601(deliveredAt)) {
			throw badRequest('Webhook deliveredAt must be an ISO 8601 date');
		}
		return {
			eventId,
			orderId,
			trackingCode,
			deliveredAt: new Date(deliveredAt),
		};
	}
}
