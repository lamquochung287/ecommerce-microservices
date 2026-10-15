import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { OutboxWriter } from '@lib/messaging';
import type {
	CreateShipmentPayload,
	ShipmentCreatedPayload,
} from '@lib/messaging';
import { KAFKA_TOPIC, MESSAGE_TYPE } from 'libs/constant/kafka.constant';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import {
	SHIPPING_PROVIDER,
	ShippingProvider,
} from '../../providers/shipping-provider.interface';
import { CreateShipmentCommand } from '../create-shipment.command';

export interface CreateShipmentResult {
	/** false khi vận đơn đã tồn tại (mọi trạng thái) và không làm gì. */
	created: boolean;
}

/**
 * Chạy trong transaction của consumer runner: gọi carrier, lưu vận đơn và ghi outbox cùng một TX.
 * Carrier lỗi => ném ra để runner rollback và retry; hết lượt thì runner gọi nhánh FAILED.
 * Gọi carrier ngay trong TX chấp nhận được với simulator; carrier thật nên gọi ngoài TX rồi mới ghi.
 */
@CommandHandler(CreateShipmentCommand)
export class CreateShipmentHandler implements ICommandHandler<CreateShipmentCommand> {
	constructor(
		@Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
		private readonly outbox: OutboxWriter,
	) {}

	async execute(command: CreateShipmentCommand): Promise<CreateShipmentResult> {
		const { manager, orderId } = command;
		const existing = await manager.findOne(Shipment, { where: { orderId } });
		if (existing) return { created: false };

		const payload = this.parsePayload(command.payload);
		const { trackingCode, carrier } = await this.provider.createShipment({
			orderId,
			recipient: payload.recipient,
			items: payload.items,
		});

		await manager.insert(Shipment, {
			orderId,
			status: ShipmentStatus.CREATED,
			trackingCode,
			carrier,
		});
		const event: ShipmentCreatedPayload = { trackingCode };
		await this.outbox.append(manager, {
			topic: KAFKA_TOPIC.SHIPPING_EVENTS,
			type: MESSAGE_TYPE.SHIPMENT_CREATED,
			orderId,
			payload: event,
		});
		return { created: true };
	}

	// Payload sai hình dạng không bao giờ thành công khi retry, nhưng vẫn ném lỗi để đơn nhận ShipmentFailed
	// (qua DLQ) thay vì kẹt chờ vận đơn.
	private parsePayload(payload: unknown): CreateShipmentPayload {
		const p = payload as Partial<CreateShipmentPayload> | null | undefined;
		if (
			!p ||
			typeof p.recipient !== 'object' ||
			p.recipient === null ||
			!Array.isArray(p.items) ||
			p.items.length === 0
		) {
			throw new Error('Invalid CreateShipment payload');
		}
		return p as CreateShipmentPayload;
	}
}
