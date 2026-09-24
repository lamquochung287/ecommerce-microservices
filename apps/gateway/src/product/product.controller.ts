import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import { CreateProductDto, UpdateProductDto } from '../../../product/src/dto/product.dto';

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
  getProducts(@Query('page') page?: string, @Query('limit') limit?: string) {
    let pageNumber = page ? parseInt(page, 10) : 1;
    let limitNumber = limit ? parseInt(limit, 10) : 20;
    
    if (isNaN(pageNumber) || pageNumber <= 0) pageNumber = 1;
    if (isNaN(limitNumber) || limitNumber <= 0) limitNumber = 20;
    return this.productService.getProducts(pageNumber, limitNumber);
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
}
