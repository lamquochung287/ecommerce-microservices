import {
	Controller,
	Get,
	Param,
	ParseUUIDPipe,
	Post,
	UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ShippingService } from './shipping.service';

@ApiTags('Shipments')
@Controller('shipments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ShipmentController {
	constructor(private readonly shippingService: ShippingService) {}

	// Kích hoạt tay "đã giao" (admin/mô phỏng); Shipping tắt route này khi production.
	@Post(':orderId/deliver')
	@RequirePermission(ModuleName.ORDER, Action.UPDATE)
	deliver(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
		return this.shippingService.simulateDelivery(orderId);
	}

	@Get(':orderId')
	@RequirePermission(ModuleName.ORDER, Action.READ)
	getShipment(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
		return this.shippingService.getShipment(orderId);
	}
}
