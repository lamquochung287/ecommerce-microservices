import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import {
	CreateProductDto,
	GetProductsFilterDto,
	UpdateProductDto,
} from '../../../product/src/dto/product.dto';
import {
	CreateBrandDto,
	UpdateBrandDto,
} from '../../../product/src/dto/brand.dto';
import {
	CreateAttributeDto,
	UpdateAttributeDto,
} from '../../../product/src/dto/attribute.dto';
import {
	AdjustStockDto,
	CreateVariantDto,
	UpdateVariantDto,
} from '../../../product/src/dto/product-variant.dto';

@Injectable()
export class ProductService {
	constructor(
		@Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
		private readonly productClient: ClientProxy,
		private readonly tcpResilience: TcpResilienceService,
	) {}

	private async send(cmd: string, payload: unknown, action: string) {
		try {
			return await this.tcpResilience.send(
				NAME_SERVICE_TCP.PRODUCT_SERVICE,
				this.productClient,
				{ cmd },
				payload,
			);
		} catch (error) {
			MicroserviceErrorHandler.handleError(error, action, 'Product service');
		}
	}

	createProduct(dto: CreateProductDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.CREATE_PRODUCT,
			dto,
			'create product',
		);
	}

	getProducts(filter: GetProductsFilterDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.GET_PRODUCTS,
			filter,
			'get products',
		);
	}

	getProduct(id: string) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.GET_PRODUCT,
			{ id },
			'get product',
		);
	}

	updateProduct(id: string, dto: UpdateProductDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.UPDATE_PRODUCT,
			{ id, dto },
			'update product',
		);
	}

	deleteProduct(id: string) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.DELETE_PRODUCT,
			{ id },
			'delete product',
		);
	}

	adjustStock(dto: AdjustStockDto) {
		return this.send(PRODUCT_MESSAGE_PATTERN.ADJUST_STOCK, dto, 'adjust stock');
	}

	createBrand(dto: CreateBrandDto) {
		return this.send(PRODUCT_MESSAGE_PATTERN.CREATE_BRAND, dto, 'create brand');
	}

	getBrands() {
		return this.send(PRODUCT_MESSAGE_PATTERN.GET_BRANDS, {}, 'get brands');
	}

	updateBrand(id: string, dto: UpdateBrandDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.UPDATE_BRAND,
			{ id, dto },
			'update brand',
		);
	}

	deleteBrand(id: string) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.DELETE_BRAND,
			{ id },
			'delete brand',
		);
	}

	createAttribute(dto: CreateAttributeDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.CREATE_ATTRIBUTE,
			dto,
			'create attribute',
		);
	}

	getAttributes() {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.GET_ATTRIBUTES,
			{},
			'get attributes',
		);
	}

	updateAttribute(id: string, dto: UpdateAttributeDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.UPDATE_ATTRIBUTE,
			{ id, dto },
			'update attribute',
		);
	}

	deleteAttribute(id: string) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.DELETE_ATTRIBUTE,
			{ id },
			'delete attribute',
		);
	}

	createVariant(dto: CreateVariantDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.CREATE_VARIANT,
			dto,
			'create variant',
		);
	}

	getVariants(productId: string) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.GET_VARIANTS,
			{ productId },
			'get variants',
		);
	}

	updateVariant(id: string, dto: UpdateVariantDto) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.UPDATE_VARIANT,
			{ id, dto },
			'update variant',
		);
	}

	deleteVariant(id: string) {
		return this.send(
			PRODUCT_MESSAGE_PATTERN.DELETE_VARIANT,
			{ id },
			'delete variant',
		);
	}
}
