import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Body,
	Param,
	UseGuards,
	UseInterceptors,
	UploadedFile,
	Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import {
	CreateProductDto,
	GetProductsFilterDto,
	UpdateProductDto,
} from '../../../product/src/dto/product.dto';
import { AdjustStockDto } from '../../../product/src/dto/product-variant.dto';
import { MediaService } from '@lib/media';

@ApiTags('Products')
@Controller('products')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProductController {
	constructor(
		private readonly productService: ProductService,
		private readonly mediaService: MediaService,
	) {}

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
	adjustStock(
		@Param('id') id: string,
		@Body() dto: Omit<AdjustStockDto, 'productId'>,
	) {
		return this.productService.adjustStock({ ...dto, productId: id });
	}

	@Get(':id/variants')
	@RequirePermission(ModuleName.PRODUCT, Action.READ)
	getVariants(@Param('id') id: string) {
		return this.productService.getVariants(id);
	}

	@Post(':id/images')
	@RequirePermission(ModuleName.PRODUCT, Action.UPDATE)
	@UseInterceptors(FileInterceptor('file'))
	async uploadProductImage(
		@Param('id') id: string,
		@UploadedFile() file: Express.Multer.File,
	) {
		const objectPath = await this.mediaService.uploadFile(file, 'products');
		const product = (await this.productService.getProduct(id)) as
			| { images?: string[] }
			| undefined;
		const images = [...(product?.images ?? []), objectPath];
		return this.productService.updateProduct(id, { images });
	}
}
