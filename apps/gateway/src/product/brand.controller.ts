import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import { CreateBrandDto, UpdateBrandDto } from '../../../product/src/dto/brand.dto';

@ApiTags('Product Brands')
@Controller('brands')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BrandController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RequirePermission(ModuleName.PRODUCT, Action.CREATE)
  createBrand(@Body() dto: CreateBrandDto) {
    return this.productService.createBrand(dto);
  }

  @Get()
  @RequirePermission(ModuleName.PRODUCT, Action.READ)
  getBrands() {
    return this.productService.getBrands();
  }

  @Put(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.UPDATE)
  updateBrand(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.productService.updateBrand(id, dto);
  }

  @Delete(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.DELETE)
  deleteBrand(@Param('id') id: string) {
    return this.productService.deleteBrand(id);
  }
}
