import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { OrdersService } from './orders.service';
import { CreateRefundDto } from '../../../orders/src/dto/refund.dto';

@Controller('refunds')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RefundController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @RequirePermission(ModuleName.ORDER, Action.CREATE)
  createRefund(@Body() dto: CreateRefundDto) {
    return this.ordersService.createRefund(dto);
  }

  @Post(':id/approve')
  @RequirePermission(ModuleName.ORDER, Action.UPDATE)
  approveRefund(@Param('id') id: string) {
    return this.ordersService.approveRefund(id);
  }

  @Post(':id/reject')
  @RequirePermission(ModuleName.ORDER, Action.UPDATE)
  rejectRefund(@Param('id') id: string) {
    return this.ordersService.rejectRefund(id);
  }
}
