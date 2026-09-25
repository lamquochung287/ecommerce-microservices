import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { AdjustStockCommand } from '../adjust-stock.command';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, OptimisticLockVersionMismatchError } from 'typeorm';
import { Product } from '../../entities/product.entity';
import { ProductVariant } from '../../entities/product-variant.entity';
import { RpcException } from '@nestjs/microservices';

const MAX_RETRIES = 1;

@CommandHandler(AdjustStockCommand)
export class AdjustStockHandler implements ICommandHandler<AdjustStockCommand> {
	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
	) {}

	async execute(command: AdjustStockCommand) {
		const { dto } = command;

		if (!dto.productId && !dto.variantId) {
			throw new RpcException({ statusCode: 400, message: 'productId hoặc variantId là bắt buộc' });
		}

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				return await this.tryAdjust(dto.productId, dto.variantId, dto.delta);
			} catch (error) {
				if (error instanceof OptimisticLockVersionMismatchError && attempt < MAX_RETRIES) {
					continue;
				}
				if (error instanceof OptimisticLockVersionMismatchError) {
					throw new RpcException({ statusCode: 409, message: 'Stock đang được cập nhật bởi request khác, thử lại' });
				}
				throw error;
			}
		}
	}

	private async tryAdjust(productId: string | undefined, variantId: string | undefined, delta: number) {
		return this.dataSource.transaction(async (manager) => {
			if (variantId) {
				const variant = await manager.findOne(ProductVariant, { where: { id: variantId } });
				if (!variant) {
					throw new RpcException({ statusCode: 404, message: 'Variant not found' });
				}
				const nextStock = variant.stock + delta;
				if (nextStock < 0) {
					throw new RpcException({ statusCode: 409, message: 'Không đủ tồn kho' });
				}
				variant.stock = nextStock;
				return manager.save(variant);
			}

			const product = await manager.findOne(Product, { where: { id: productId } });
			if (!product) {
				throw new RpcException({ statusCode: 404, message: 'Product not found' });
			}
			const nextStock = product.stock + delta;
			if (nextStock < 0) {
				throw new RpcException({ statusCode: 409, message: 'Không đủ tồn kho' });
			}
			product.stock = nextStock;
			return manager.save(product);
		});
	}
}
