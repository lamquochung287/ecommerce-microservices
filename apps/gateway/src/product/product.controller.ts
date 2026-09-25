import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import { CreateProductDto, GetProductsFilterDto, UpdateProductDto } from '../../../product/src/dto/product.dto';
import { AdjustStockDto } from '../../../product/src/dto/product-variant.dto';

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RequirePermission(ModuleName.PRODUCT, Action.CREATE)
  createProduct(@Body() dto: CreateProductDto) {
    return this.productService.createProduct(dto);
  }

  @Get()
  @RequirePermission(ModuleName.PRODUCT, Action.READ)
  getProducts(@Query() filter: GetProductsFilterDto) {
    return this.productService.getProducts(filter);
  }

  @Get(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.READ)
  getProduct(@Param('id') id: string) {
    return this.productService.getProduct(id);
  }

  @Put(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.UPDATE)
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productService.updateProduct(id, dto);
  }

  @Delete(':id')
  @RequirePermission(ModuleName.PRODUCT, Action.DELETE)
  deleteProduct(@Param('id') id: string) {
    return this.productService.deleteProduct(id);
  }

  @Post(':id/stock-adjustments')
  @RequirePermission(ModuleName.PRODUCT, Action.UPDATE)
  adjustStock(@Param('id') id: string, @Body() dto: Omit<AdjustStockDto, 'productId'>) {
    return this.productService.adjustStock({ ...dto, productId: id });
  }

  @Get(':id/variants')
  @RequirePermission(ModuleName.PRODUCT, Action.READ)
  getVariants(@Param('id') id: string) {
    return this.productService.getVariants(id);
  }
}
