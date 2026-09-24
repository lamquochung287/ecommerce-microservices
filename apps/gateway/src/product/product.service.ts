import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NAME_SERVICE_TCP } from 'libs/constant/port-tcp.constant';
import { PRODUCT_MESSAGE_PATTERN } from 'libs/constant/message-pattern.constant';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice-error.handler';
import { CreateProductDto, UpdateProductDto } from '../../../product/src/dto/product.dto';

@Injectable()
export class ProductService {
  constructor(@Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE) private readonly productClient: ClientProxy) {}

  async createProduct(dto: CreateProductDto) {
    try {
      return await firstValueFrom(this.productClient.send({ cmd: PRODUCT_MESSAGE_PATTERN.CREATE_PRODUCT }, dto).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'create product', 'Product service');
    }
  }

  async getProducts(page: number = 1, limit: number = 20) {
    try {
      return await firstValueFrom(this.productClient.send({ cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCTS }, { page, limit }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get products', 'Product service');
    }
  }

  async getProduct(id: string) {
    try {
      return await firstValueFrom(this.productClient.send({ cmd: PRODUCT_MESSAGE_PATTERN.GET_PRODUCT }, { id }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'get product', 'Product service');
    }
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    try {
      return await firstValueFrom(this.productClient.send({ cmd: PRODUCT_MESSAGE_PATTERN.UPDATE_PRODUCT }, { id, dto }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'update product', 'Product service');
    }
  }

  async deleteProduct(id: string) {
    try {
      return await firstValueFrom(this.productClient.send({ cmd: PRODUCT_MESSAGE_PATTERN.DELETE_PRODUCT }, { id }).pipe(
        timeout(10000),
        catchError((error) => throwError(() => error))
      ));
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, 'delete product', 'Product service');
    }
  }
}
