import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../../entities/shipment.entity';
import {
	SHIPPING_PROVIDER,
	ShippingProvider,
} from '../../providers/shipping-provider.interface';
import { WebhookResult } from './handle-shipping-webhook.handler';
import { HandleShippingWebhookCommand } from '../handle-shipping-webhook.command';
import { SimulateDeliveryCommand } from '../simulate-delivery.command';

/**
 * Đóng vai carrier: dựng webhook "đã giao" có ký rồi chạy qua HandleShippingWebhook, tức đúng đường
 * verify như webhook thật. eventId tất định theo vận đơn nên gọi lặp là webhook trùng và bị inbox chặn.
 */
@CommandHandler(SimulateDeliveryCommand)
export class SimulateDeliveryHandler implements ICommandHandler<SimulateDeliveryCommand> {
	constructor(
		@InjectRepository(Shipment)
		private readonly shipments: Repository<Shipment>,
		@Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
		private readonly config: ConfigService,
		private readonly commandBus: CommandBus,
	) {}

	async execute(command: SimulateDeliveryCommand): Promise<WebhookResult> {
		if (this.config.get<string>('NODE_ENV') === 'production') {
			throw new RpcException({ statusCode: 404, message: 'Not Found' });
		}
		const shipment = await this.shipments.findOne({
			where: { orderId: command.orderId },
		});
		if (!shipment) {
			throw new RpcException({
				statusCode: 404,
				message: 'Shipment not found',
			});
		}
		if (!shipment.trackingCode) {
			throw new RpcException({
				statusCode: 409,
				message: 'Shipment has no tracking code',
			});
		}

		const payload: Record<string, unknown> = {
			eventId: `${shipment.id}:delivered`,
			orderId: shipment.orderId,
			trackingCode: shipment.trackingCode,
			status: 'DELIVERED',
			deliveredAt: new Date().toISOString(),
		};
		const signature = this.provider.signWebhook(payload);
		return this.commandBus.execute<HandleShippingWebhookCommand, WebhookResult>(
			new HandleShippingWebhookCommand({ payload, signature }),
		);
	}
}
