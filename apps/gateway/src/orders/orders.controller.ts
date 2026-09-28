import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderStatusDto } from '../../../orders/src/dto/order.dto';

@ApiTags('Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @RequirePermission(ModuleName.ORDER, Action.CREATE)
  createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

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

  @Patch(':id/status')
  @RequirePermission(ModuleName.ORDER, Action.UPDATE)
  updateOrderStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateOrderStatus(id, dto);
  }

  @Get(':id/refunds')
  @RequirePermission(ModuleName.ORDER, Action.READ)
  getRefunds(@Param('id') id: string) {
    return this.ordersService.getRefunds(id);
  }
}
