import {
	Controller,
	Get,
	Post,
	Put,
	Delete,
	Body,
	Param,
	UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { PermissionGuard } from '../common/guard/permission.guard';
import { RequirePermission } from '../common/decorator/require-permission.decorator';
import { Action, ModuleName } from 'libs/constant/permission.constant';
import { ProductService } from './product.service';
import {
	CreateAttributeDto,
	UpdateAttributeDto,
} from '../../../product/src/dto/attribute.dto';

@ApiTags('Product Attributes')
@Controller('attributes')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AttributeController {
	constructor(private readonly productService: ProductService) {}

	@Post()
	@RequirePermission(ModuleName.PRODUCT, Action.CREATE)
	createAttribute(@Body() dto: CreateAttributeDto) {
		return this.productService.createAttribute(dto);
	}

	@Get()
	@RequirePermission(ModuleName.PRODUCT, Action.READ)
	getAttributes() {
		return this.productService.getAttributes();
	}

	@Put(':id')
	@RequirePermission(ModuleName.PRODUCT, Action.UPDATE)
	updateAttribute(@Param('id') id: string, @Body() dto: UpdateAttributeDto) {
		return this.productService.updateAttribute(id, dto);
	}

	@Delete(':id')
	@RequirePermission(ModuleName.PRODUCT, Action.DELETE)
	deleteAttribute(@Param('id') id: string) {
		return this.productService.deleteAttribute(id);
	}
}
