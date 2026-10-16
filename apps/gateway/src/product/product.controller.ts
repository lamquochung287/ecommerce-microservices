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
	ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, OmitType } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Public } from '../common/decorator/public.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import {
	CreateProductDto,
	GetProductsFilterDto,
	UpdateProductDto,
} from '../../../product/src/dto/product.dto';
import { AdjustStockDto } from '../../../inventory/src/dto/inventory.dto';
import { MediaService } from '@lib/media';
import { InventoryService } from './inventory.service';

// Body không có productId (lấy từ path) nhưng vẫn giữ decorator validate của AdjustStockDto.
class AdjustStockBodyDto extends OmitType(AdjustStockDto, [
	'productId',
] as const) {}

interface ProductWithId {
	id: string;
	[key: string]: unknown;
}

@ApiTags('Products')
@Controller('products')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProductController {
	constructor(
		private readonly productService: ProductService,
		private readonly inventoryService: InventoryService,
		private readonly mediaService: MediaService,
	) {}

	@Post()
	@RequirePermission(ModuleName.PRODUCT, Action.CREATE)
	createProduct(@Body() dto: CreateProductDto) {
		return this.productService.createProduct(dto);
	}

	// Danh sách và chi tiết sản phẩm công khai: không cần đăng nhập (vẫn cần x-api-key).
	@Get()
	@Public()
	async getProducts(@Query() filter: GetProductsFilterDto) {
		const page = (await this.productService.getProducts(filter)) as
			| { data?: ProductWithId[]; meta?: unknown }
			| undefined;
		const items = page?.data ?? [];
		// Một lần gọi Inventory cho cả trang; Inventory lỗi thì mọi item là UNKNOWN (không ném lỗi).
		const stock = await this.inventoryService.getStockInfo(
			items.map((item) => item.id),
		);
		return {
			...page,
			data: items.map((item) => ({
				...item,
				...InventoryService.stockInfoOf(stock, item.id),
			})),
		};
	}

	@Get(':id')
	@Public()
	async getProduct(@Param('id') id: string) {
		const product = (await this.productService.getProduct(id)) as
			| ProductWithId
			| null
			| undefined;
		if (!product) return product;
		const stock = await this.inventoryService.getStockInfo([product.id]);
		return { ...product, ...InventoryService.stockInfoOf(stock, product.id) };
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
		@Param('id', new ParseUUIDPipe()) id: string,
		@Body() dto: AdjustStockBodyDto,
	) {
		return this.inventoryService.adjustStock({ ...dto, productId: id });
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
