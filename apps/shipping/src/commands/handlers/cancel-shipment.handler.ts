import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Shipment, ShipmentStatus } from '../../entities/shipment.entity';
import {
	SHIPPING_PROVIDER,
	ShippingProvider,
} from '../../providers/shipping-provider.interface';
import { CancelShipmentCommand } from '../cancel-shipment.command';

/**
 * Lệnh bù trừ, idempotent: chỉ vận đơn CREATED mới bị huỷ. Khoá dòng để không đua với webhook giao hàng.
 * Vận đơn đã DELIVERED không bị đổi (hàng đã tới tay khách) và chỉ cảnh báo.
 */
@CommandHandler(CancelShipmentCommand)
export class CancelShipmentHandler implements ICommandHandler<CancelShipmentCommand> {
	private readonly logger = new Logger(CancelShipmentHandler.name);

	constructor(
		@Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
	) {}

	async execute(command: CancelShipmentCommand): Promise<void> {
		const { manager, orderId } = command;
		const shipment = await manager.findOne(Shipment, {
			where: { orderId },
			lock: { mode: 'pessimistic_write' },
		});
		if (!shipment) return;

		if (shipment.status === ShipmentStatus.DELIVERED) {
			this.logger.warn(
				`Bỏ qua CancelShipment cho đơn ${orderId}: vận đơn đã giao`,
			);
			return;
		}
		if (shipment.status !== ShipmentStatus.CREATED) return;

		if (shipment.trackingCode) {
			await this.provider.cancelShipment(shipment.trackingCode);
		}
		await manager.update(Shipment, shipment.id, {
			status: ShipmentStatus.CANCELLED,
		});
	}
}
