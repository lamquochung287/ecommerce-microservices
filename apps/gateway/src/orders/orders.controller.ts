import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class OrdersController {
	constructor(private readonly ordersService: OrdersService) {}

	@Get()
	@RequirePermission(ModuleName.ORDER, Action.READ)
	getOrders(@Query('userId') userId?: string) {
		return this.ordersService.getOrders(userId);
	}

	@Get(':id')
	@RequirePermission(ModuleName.ORDER, Action.READ)
	getOrder(@Param('id') id: string) {
		return this.ordersService.getOrder(id);
	}

	@Get(':id/refunds')
	@RequirePermission(ModuleName.ORDER, Action.READ)
	getRefunds(@Param('id') id: string) {
		return this.ordersService.getRefunds(id);
	}
}
