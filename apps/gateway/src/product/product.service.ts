import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { TcpResilienceService } from '../common/tcp-resilience.service';
import { CreateProductDto, UpdateProductDto } from '../../../product/src/dto/product.dto';

@Injectable()
export class ProductService {
  constructor(
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE) private readonly productClient: ClientProxy,
    private readonly tcpResilience: TcpResilienceService,
  ) {}

  async createProduct(dto: CreateProductDto) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.PRODUCT_SERVICE,
        this.productClient,
        { cmd: PRODUCT_MESSAGE_PATTERN.CREATE_PRODUCT },
        dto,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'create product', 'Product service');
    }
  }

  async getProducts(page: number = 1, limit: number = 20) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.PRODUCT_SERVICE,
        this.productClient,
        { cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCTS },
        { page, limit },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get products', 'Product service');
    }
  }

  async getProduct(id: string) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.PRODUCT_SERVICE,
        this.productClient,
        { cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCT },
        { id },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get product', 'Product service');
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.PRODUCT_SERVICE,
        this.productClient,
        { cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_PRODUCT },
        { id, dto },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'update product', 'Product service');
    }
  }

  async deleteProduct(id: string) {
    try {
      return await this.tcpResilience.send(
        NAME_SERVICE_TCP.PRODUCT_SERVICE,
        this.productClient,
        { cmd: PRODUCT_MESSAGE_PATTERN.DELETE_PRODUCT },
        { id },
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'delete product', 'Product service');
    }
  }
}
