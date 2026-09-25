import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { PromotionService } from './promotion.service';
import { CreateVoucherDto, ApplyVoucherDto } from '../../../promotion/src/dto/voucher.dto';

@Controller('vouchers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PromotionController {
  constructor(private readonly promotionService: PromotionService) {}

  @Post()
  @RequirePermission(ModuleName.PROMOTION, Action.CREATE)
  createVoucher(@Body() dto: CreateVoucherDto) {
    return this.promotionService.createVoucher(dto);
  }

  @Get()
  @RequirePermission(ModuleName.PROMOTION, Action.READ)
  getVouchers() {
    return this.promotionService.getVouchers();
  }

  @Get('available')
  @RequirePermission(ModuleName.PROMOTION, Action.READ)
  getAvailableVouchers() {
    return this.promotionService.getAvailableVouchers();
  }

  @Post('apply')
  @RequirePermission(ModuleName.PROMOTION, Action.READ)
  applyVoucher(@Body() dto: ApplyVoucherDto) {
    return this.promotionService.applyVoucher(dto);
  }
}
