import { Controller, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import { CreateVariantDto, UpdateVariantDto } from '../../../product/src/dto/product-variant.dto';

@Controller('variants')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class VariantController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RequirePermission(ModuleName.PRODUCT, Action.CREATE)
  createVariant(@Body() dto: CreateVariantDto) {
    return this.productService.createVariant(dto);
  }

  @Put(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.UPDATE)
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.productService.updateVariant(id, dto);
  }

  @Delete(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.DELETE)
  deleteVariant(@Param('id') id: string) {
    return this.productService.deleteVariant(id);
  }
}
